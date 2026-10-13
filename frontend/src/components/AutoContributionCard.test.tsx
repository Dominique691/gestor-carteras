import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

type CardProps = Omit<Parameters<typeof AutoContributionCard>[0], "amount" | "onAmountChange">;

/** El importe vive en «Nueva Aportación» (la página): aquí lo simula un estado mínimo. */
function Harness({ initialAmount, ...props }: Partial<CardProps> & { initialAmount: string }) {
  const [amount, setAmount] = useState(initialAmount);
  return (
    <>
      <input aria-label="Nueva Aportación (€)" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <AutoContributionCard
        hasSavedTargets
        hasUnsavedTargets={false}
        onExecuted={() => {}}
        {...props}
        amount={amount}
        onAmountChange={setAmount}
      />
    </>
  );
}

const renderCard = (props: Partial<CardProps> & { initialAmount?: string } = {}) =>
  render(<Harness {...props} initialAmount={props.initialAmount ?? ""} />);

/** Enciende el interruptor «Repetir automáticamente» (sin plan, la sección está plegada). */
const enable = async () => userEvent.click(await screen.findByRole("switch", { name: "Repetir automáticamente" }));

afterEach(() => vi.unstubAllGlobals());

describe("AutoContributionCard", () => {
  it("sin plan permite programar una aportación trimestral", async () => {
    const fetchMock = mockApi({ plan: null, runs: [] });
    renderCard({ initialAmount: "250" });

    // Plegada por defecto: no hay frecuencia ni fecha hasta encender el interruptor.
    expect(await screen.findByRole("switch", { name: "Repetir automáticamente" })).not.toBeChecked();
    expect(screen.queryByLabelText("Primera aportación")).not.toBeInTheDocument();
    await enable();
    expect(screen.queryByLabelText("Importe (€)")).not.toBeInTheDocument(); // usa el importe de «Nueva Aportación»
    const amount = screen.getByLabelText("Nueva Aportación (€)");
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
    renderCard({ hasSavedTargets: false, initialAmount: "100" });
    await enable();

    expect(await screen.findByText(/Guarda primero tus porcentajes objetivo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar aportación automática" })).toBeDisabled();
  });

  it("con un plan existente no hay interruptor y editar carga su importe en «Nueva Aportación»", async () => {
    mockApi({ plan: activePlan, runs: [] });
    renderCard({ initialAmount: "1000" });

    expect(await screen.findByText(/Próxima aportación/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText("Nueva Aportación (€)")).toHaveValue("300");
    expect(screen.getByLabelText("Primera aportación")).toHaveValue("2026-10-15");
  });

  it("no deja activarla con un importe menor de 1 €", async () => {
    mockApi({ plan: null, runs: [] });
    renderCard({ initialAmount: "0,50" });
    await enable();

    expect(screen.getByRole("alert")).toHaveTextContent("al menos 1 €");
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
    renderCard({ initialAmount: "100", onExecuted });

    await enable();
    await userEvent.click(await screen.findByRole("button", { name: "Activar aportación automática" }));
    expect(await screen.findByText("2 compras registradas")).toBeInTheDocument();
    expect(onExecuted).toHaveBeenCalledTimes(1);
  });

  it("muestra el error del backend al guardar", async () => {
    mockApi({ plan: null, runs: [] }, () => json(422, { error: "Guarda primero tus porcentajes objetivo" }));
    renderCard({ initialAmount: "100" });

    await enable();
    await userEvent.click(await screen.findByRole("button", { name: "Activar aportación automática" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Guarda primero tus porcentajes objetivo");
  });

  it("permite eliminar el plan", async () => {
    const fetchMock = mockApi({ plan: activePlan, runs: [] });
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: "Eliminar" }));
    // Sin plan vuelve el interruptor, apagado.
    expect(await screen.findByRole("switch", { name: "Repetir automáticamente" })).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledWith("/api/contributions", expect.objectContaining({ method: "DELETE" }));
  });
});
