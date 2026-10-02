import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fmt from "@/lib/format";
import type { Fund, Portfolio } from "@/lib/types";
import Rebalance from "./Rebalance";

const nbsp = (s: string) => s.replace(/ /g, " ");
const eur = (n: number) => nbsp(fmt.formatEur(n));
const pct = (n: number) => nbsp(fmt.formatPercent(n));

const funds: Fund[] = [
  { id: "A", isin: "ISIN-A", name: "Fondo Mundial", category: "Renta Variable", currentNAV: 100 },
  { id: "B", isin: "ISIN-B", name: "Fondo Bonos", category: "Renta Fija", currentNAV: 50 },
  { id: "C", isin: "ISIN-C", name: "Fondo Emergentes", category: "Renta Variable", currentNAV: 20 },
];

// A pesa 80 % y B 20 % (10.000 €), frente a un objetivo guardado de 70/30.
const portfolio: Portfolio = {
  totalValue: 10000,
  totalInvested: 9000,
  pnl: 1000,
  pnlPercentage: 11.11,
  realizedPnl: 0,
  positions: [
    { fundId: "A", isin: "ISIN-A", name: "Fondo Mundial", category: "Renta Variable", shares: 80, averageBuyPrice: 90, currentNAV: 100, currentValue: 8000, invested: 7200, pnl: 800, pnlPercentage: 11.11, portfolioPercentage: 80, targetPercentage: 70 },
    { fundId: "B", isin: "ISIN-B", name: "Fondo Bonos", category: "Renta Fija", shares: 40, averageBuyPrice: 45, currentNAV: 50, currentValue: 2000, invested: 1800, pnl: 200, pnlPercentage: 11.11, portfolioPercentage: 20, targetPercentage: 30 },
  ],
  targets: [
    { fundId: "A", isin: "ISIN-A", name: "Fondo Mundial", targetPercentage: 70, currentPercentage: 80 },
    { fundId: "B", isin: "ISIN-B", name: "Fondo Bonos", targetPercentage: 30, currentPercentage: 20 },
  ],
};

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function mockApi() {
  const calls: { url: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method === "POST") calls.push({ url, body });
    if (url === "/api/portfolio") return json(200, portfolio);
    if (url === "/api/funds") return json(200, funds);
    if (url === "/api/portfolio/targets") return json(200, []);
    if (url === "/api/transactions") return json(201, {});
    return json(404, { error: "no encontrado" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

afterEach(() => vi.unstubAllGlobals());

/** La tabla de resultados es la que tiene la columna «Aportación Sugerida (€)». */
const resultTable = () =>
  screen
    .getAllByRole("table")
    .find((t) => within(t).queryByRole("columnheader", { name: "Aportación Sugerida (€)" }))!;

describe("Rebalance", () => {
  it("carga los objetivos guardados y confirma que suman 100 %", async () => {
    mockApi();
    render(<Rebalance />);

    expect(await screen.findByLabelText("% objetivo de Fondo Mundial")).toHaveValue("70");
    expect(screen.getByLabelText("% objetivo de Fondo Bonos")).toHaveValue("30");
    expect(screen.getByText("Los objetivos suman 100 %")).toBeInTheDocument();
  });

  it("con 1.000 € sugiere comprar el infraponderado y resalta la sugerencia en verde", async () => {
    mockApi();
    render(<Rebalance />);
    await userEvent.type(await screen.findByLabelText("Nueva Aportación (€)"), "1000");

    const table = within(resultTable());
    const bonos = table.getByText("Fondo Bonos").closest("tr")!;
    const mundial = table.getByText("Fondo Mundial").closest("tr")!;

    // 11.000 × 30 % = 3.300 → 1.300 de déficit, limitado a la aportación de 1.000 €.
    expect(within(bonos).getByText(`+ ${eur(1000)}`)).toBeInTheDocument();
    expect(within(bonos).getByText(pct(20))).toBeInTheDocument();
    expect(within(bonos).getByText(pct(30))).toBeInTheDocument();
    expect(within(mundial).queryByText(/^\+/)).not.toBeInTheDocument(); // sin sugerencia: solo «—»
    expect(within(mundial).getByText("—")).toBeInTheDocument();
  });

  it("si los objetivos no suman 100 % avisa y oculta el resultado", async () => {
    mockApi();
    render(<Rebalance />);
    const input = await screen.findByLabelText("% objetivo de Fondo Mundial");
    await userEvent.clear(input);
    await userEvent.type(input, "60");

    expect(screen.getByText(/Faltan 10,00 % para llegar a 100 %/)).toBeInTheDocument();
    expect(screen.getByText("Ajusta los objetivos hasta que sumen 100 % para ver el resultado.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /guardar objetivos/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /ejecutar rebalanceo/i })).not.toBeInTheDocument();
  });

  it("permite añadir un fondo, guardar los objetivos y omite los de 0 %", async () => {
    const { calls } = mockApi();
    render(<Rebalance />);
    await screen.findByLabelText("% objetivo de Fondo Mundial");

    await userEvent.click(screen.getByRole("combobox", { name: "Añadir fondo" }));
    await userEvent.click(await screen.findByRole("option", { name: "Fondo Emergentes" }));
    const mundial = screen.getByLabelText("% objetivo de Fondo Mundial");
    await userEvent.clear(mundial);
    await userEvent.type(mundial, "50");
    await userEvent.type(screen.getByLabelText("% objetivo de Fondo Emergentes"), "20");
    expect(screen.getByText("Los objetivos suman 100 %")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /guardar objetivos/i }));

    expect(await screen.findByText("Objetivos guardados")).toBeInTheDocument();
    expect(calls).toContainEqual({
      url: "/api/portfolio/targets",
      body: {
        targets: [
          { fundId: "A", targetPercentage: 50 },
          { fundId: "B", targetPercentage: 30 },
          { fundId: "C", targetPercentage: 20 },
        ],
      },
    });
  });

  it("ejecutar rebalanceo: muestra la simulación y crea las compras al confirmar", async () => {
    const { calls } = mockApi();
    render(<Rebalance />);
    await userEvent.type(await screen.findByLabelText("Nueva Aportación (€)"), "1000");

    await userEvent.click(screen.getByRole("button", { name: /ejecutar rebalanceo/i }));
    const dialog = within(await screen.findByRole("dialog"));

    // Simulación: 1.000 € al NAV de 50 € = 20 participaciones; todavía no se ha creado nada.
    expect(dialog.getByText("Simulación de rebalanceo")).toBeInTheDocument();
    expect(dialog.getByText("Fondo Bonos")).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "/api/transactions")).toHaveLength(0);

    await userEvent.click(dialog.getByRole("button", { name: "Crear transacciones" }));

    expect(await dialog.findByText(/Rebalanceo completado: 1 compra creada/)).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "/api/transactions")).toEqual([
      { url: "/api/transactions", body: { fundId: "B", type: "BUY", shares: 20, pricePerShare: 50 } },
    ]);

    // Al cerrar se recargan los datos y se limpia la aportación.
    await userEvent.click(dialog.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.getByLabelText("Nueva Aportación (€)")).toHaveValue(""));
  });

  it("recalcula las sugerencias de la tabla cada vez que cambia la aportación", async () => {
    mockApi();
    render(<Rebalance />);
    const input = await screen.findByLabelText("Nueva Aportación (€)");

    const rowOf = (name: string) => within(within(resultTable()).getByText(name).closest("tr")!);
    const footer = () => within(resultTable().querySelector("tfoot") as HTMLElement);

    // Sin aportación: cartera 80/20 frente a 70/30, pero no hay dinero que repartir.
    expect(rowOf("Fondo Bonos").getByText("—")).toBeInTheDocument();
    expect(rowOf("Fondo Mundial").getByText("—")).toBeInTheDocument();
    expect(screen.getByText(eur(10000), { selector: "span" })).toBeInTheDocument(); // patrimonio tras aportar

    // 500 € → todo al fondo infraponderado (déficit 1.300 € > 500 €).
    await userEvent.type(input, "500");
    expect(rowOf("Fondo Bonos").getByText(`+ ${eur(500)}`)).toBeInTheDocument();
    expect(rowOf("Fondo Mundial").getByText("—")).toBeInTheDocument();
    expect(footer().getByText(eur(500))).toBeInTheDocument();
    expect(screen.getByText(eur(10500), { selector: "span" })).toBeInTheDocument();

    // 3.000 € → ahora ambos están por debajo de su objetivo (9.100 € y 3.900 €).
    await userEvent.clear(input);
    await userEvent.type(input, "3000");
    expect(rowOf("Fondo Mundial").getByText(`+ ${eur(1100)}`)).toBeInTheDocument();
    expect(rowOf("Fondo Bonos").getByText(`+ ${eur(1900)}`)).toBeInTheDocument();
    expect(footer().getByText(eur(3000))).toBeInTheDocument();

    // Vaciar el campo vuelve a no sugerir nada.
    await userEvent.clear(input);
    expect(within(resultTable()).getAllByText("—")).toHaveLength(2);
    expect(within(resultTable()).queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it("recalcula también al cambiar un % objetivo (sin guardar)", async () => {
    mockApi();
    render(<Rebalance />);
    await userEvent.type(await screen.findByLabelText("Nueva Aportación (€)"), "1000");

    // Objetivo 50/50: con 11.000 € A debería tener 5.500 (<8.000) y B 5.500 (+3.500 de déficit).
    const mundial = screen.getByLabelText("% objetivo de Fondo Mundial");
    const bonos = screen.getByLabelText("% objetivo de Fondo Bonos");
    await userEvent.clear(mundial);
    await userEvent.type(mundial, "50");
    await userEvent.clear(bonos);
    await userEvent.type(bonos, "50");

    const row = within(within(resultTable()).getByText("Fondo Bonos").closest("tr")!);
    expect(row.getByText(pct(50))).toBeInTheDocument();
    expect(row.getByText(`+ ${eur(1000)}`)).toBeInTheDocument(); // sigue siendo todo para B
    expect(screen.getByRole("button", { name: /guardar objetivos/i })).toBeEnabled();
  });

  it("rechaza una aportación no válida", async () => {
    mockApi();
    render(<Rebalance />);
    await userEvent.type(await screen.findByLabelText("Nueva Aportación (€)"), "12,345");

    expect(screen.getByText(/Introduce un importe válido/)).toBeInTheDocument();
    expect(screen.getByText("Corrige la aportación para ver el resultado.")).toBeInTheDocument();
  });
});
