import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContributionPlan, Contributions } from "@/lib/types";
import { AutoContributionCard } from "./AutoContributionCard";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const activePlan: ContributionPlan = {
  amount: 300,
  frequency: "MONTHLY",
  startDate: "2026-10-15",
  active: true,
  nextRunAt: "2026-11-15",
};

/** fetch simulado: GET devuelve `initial`; PUT responde con `onPut` (por defecto, el plan enviado). */
function mockApi(initial: Contributions, onPut?: (body: Record<string, unknown>) => Promise<Response>) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      if (onPut) return onPut(body);
      return json(200, { plan: { ...body, nextRunAt: body.active ? body.startDate : null }, runs: initial.runs });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json(200, initial);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const renderCard = (props: Partial<Parameters<typeof AutoContributionCard>[0]> = {}) =>
  render(
    <AutoContributionCard hasSavedTargets hasUnsavedTargets={false} suggestedAmount={null} onExecuted={() => {}} {...props} />,
  );

afterEach(() => vi.unstubAllGlobals());

describe("AutoContributionCard", () => {
  it("sin plan permite programar una aportación trimestral", async () => {
    const fetchMock = mockApi({ plan: null, runs: [] });
    renderCard({ suggestedAmount: 250 });

    const amount = await screen.findByLabelText("Importe (€)");
    expect(amount).toHaveValue("250"); // propone el importe de «Nueva Aportación»
    await userEvent.clear(amount);
    await userEvent.type(amount, "150,50");
    await userEvent.click(screen.getByRole("combobox", { name: "Frecuencia" }));
    await userEvent.click(await screen.findByRole("option", { name: "Trimestral" }));
    const date = screen.getByLabelText("Primera aportación");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-12-01");
    await userEvent.click(screen.getByRole("button", { name: "Activar aportación automática" }));

    expect(await screen.findByText("Activa")).toBeInTheDocument();
    expect(screen.getByText(/Próxima aportación/)).toHaveTextContent("01/12/2026");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/contributions",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ amount: 150.5, frequency: "QUARTERLY", startDate: "2026-12-01", active: true }),
      }),
    );
  });

  it("sin objetivos guardados no deja activarla y explica por qué", async () => {
    mockApi({ plan: null, runs: [] });
    renderCard({ hasSavedTargets: false, suggestedAmount: 100 });

    expect(await screen.findByText(/Guarda primero tus porcentajes objetivo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar aportación automática" })).toBeDisabled();
  });

  it("muestra el plan activo, permite pausarlo y reanudarlo", async () => {
    const fetchMock = mockApi({ plan: activePlan, runs: [] });
    renderCard();

    expect(await screen.findByText(/Próxima aportación/)).toHaveTextContent("15/11/2026");
    await userEvent.click(screen.getByRole("button", { name: "Pausar" }));

    expect(await screen.findByText("Pausada")).toBeInTheDocument();
    expect(screen.getByText(/En pausa/)).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body))).toMatchObject({ active: false, amount: 300 });

    await userEvent.click(screen.getByRole("button", { name: "Reanudar" }));
    expect(await screen.findByText("Activa")).toBeInTheDocument();
  });

  it("lista las últimas ejecuciones, también las fallidas con su motivo", async () => {
    mockApi({
      plan: activePlan,
      runs: [
        { id: "2", scheduledFor: "2026-10-15", executedAt: "2026-10-15T08:00:00Z", amount: 300, status: "FAILED", purchases: 0, message: "No hay porcentajes objetivo guardados" },
        { id: "1", scheduledFor: "2026-09-15", executedAt: "2026-09-15T08:00:00Z", amount: 300, status: "SUCCESS", purchases: 2, message: null },
      ],
    });
    renderCard();

    const rows = within(await screen.findByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("15/10/2026");
    expect(rows[0]).toHaveTextContent("No se ejecutó: No hay porcentajes objetivo guardados");
    expect(rows[1]).toHaveTextContent("2 compras registradas");
  });

  it("si al guardar se ejecuta una aportación (primera fecha hoy) avisa para refrescar la cartera", async () => {
    const onExecuted = vi.fn();
    mockApi({ plan: null, runs: [] }, async (body) =>
      json(200, {
        plan: { ...body, nextRunAt: "2026-11-12" },
        runs: [{ id: "1", scheduledFor: body.startDate, executedAt: "2026-10-12T10:00:00Z", amount: 100, status: "SUCCESS", purchases: 2, message: null }],
      }),
    );
    renderCard({ suggestedAmount: 100, onExecuted });

    await userEvent.click(await screen.findByRole("button", { name: "Activar aportación automática" }));
    expect(await screen.findByText("2 compras registradas")).toBeInTheDocument();
    expect(onExecuted).toHaveBeenCalledTimes(1);
  });

  it("muestra el error del backend al guardar", async () => {
    mockApi({ plan: null, runs: [] }, () => json(422, { error: "Guarda primero tus porcentajes objetivo" }));
    renderCard({ suggestedAmount: 100 });

    await userEvent.click(await screen.findByRole("button", { name: "Activar aportación automática" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Guarda primero tus porcentajes objetivo");
  });

  it("permite eliminar el plan", async () => {
    const fetchMock = mockApi({ plan: activePlan, runs: [] });
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: "Eliminar" }));
    expect(await screen.findByRole("button", { name: "Activar aportación automática" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/contributions", expect.objectContaining({ method: "DELETE" }));
  });
});
