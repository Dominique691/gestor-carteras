import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fmt from "@/lib/format";
import type { Fund, Portfolio } from "@/lib/types";
import Dashboard from "./Dashboard";

// Intl usa espacios no separables; Testing Library normaliza el DOM pero no el texto esperado.
const nbsp = (s: string) => s.replace(/ /g, " ");
const eur = (n: number) => nbsp(fmt.formatEur(n));
const eurSigned = (n: number) => nbsp(fmt.formatEurSigned(n));
const pct = (n: number) => nbsp(fmt.formatPercent(n));
const pctSigned = (n: number) => nbsp(fmt.formatPercentSigned(n));

const funds: Fund[] = [
  { id: "f1", isin: "IE00B03HD191", name: "Vanguard Global Stock", category: "Renta Variable", currentNAV: 512.34 },
  { id: "f2", isin: "IE00B18GC888", name: "Vanguard Global Bond", category: "Renta Fija", currentNAV: 121.45 },
];

const portfolio: Portfolio = {
  totalValue: 3475.68,
  totalInvested: 3413.33,
  pnl: 62.35,
  pnlPercentage: 1.83,
  realizedPnl: 0,
  targets: [],
  positions: [
    {
      fundId: "f1", isin: "IE00B03HD191", name: "Vanguard Global Stock", category: "Renta Variable",
      shares: 4, averageBuyPrice: 600, currentNAV: 612.75, currentValue: 2451, invested: 2400,
      pnl: 51, pnlPercentage: 2.13, portfolioPercentage: 70.52, targetPercentage: null,
    },
    {
      fundId: "f2", isin: "IE00B18GC888", name: "Vanguard Global Bond", category: "Renta Fija",
      shares: 8.4321, averageBuyPrice: 120, currentNAV: 121.45, currentValue: 1024.68, invested: 1013.33,
      pnl: -11.35, pnlPercentage: -1.12, portfolioPercentage: 29.48, targetPercentage: null,
    },
  ],
};
const empty: Portfolio = { ...portfolio, totalValue: 0, totalInvested: 0, pnl: 0, pnlPercentage: 0, positions: [] };

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

/** fetch simulado: responde según URL; `onPost` captura las transacciones enviadas. */
function mockApi(data: Portfolio, onPost?: (body: unknown) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/portfolio") return json(200, data);
    if (url === "/api/funds") return json(200, funds);
    if (url === "/api/transactions" && init?.method === "POST") {
      return onPost ? onPost(JSON.parse(String(init.body))) : json(201, {});
    }
    return json(404, { error: "no encontrado" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("Dashboard", () => {
  it("muestra los KPI con el patrimonio, la inversión y el P&L", async () => {
    mockApi(portfolio);
    render(<Dashboard />);

    const kpis = within(await screen.findByRole("region", { name: "Indicadores" }));
    expect(kpis.getByText(eur(3475.68))).toBeInTheDocument();
    expect(kpis.getByText(eur(3413.33))).toBeInTheDocument();
    expect(kpis.getByText(eurSigned(62.35))).toBeInTheDocument();
    expect(kpis.getByText(pctSigned(1.83))).toBeInTheDocument();
  });

  it("agrupa la distribución por categoría (Renta Variable vs Renta Fija)", async () => {
    mockApi(portfolio);
    render(<Dashboard />);

    const legend = within(await screen.findByRole("list", { name: "Leyenda de categorías" }));
    const variable = legend.getByText("Renta Variable").closest("li")!;
    const fija = legend.getByText("Renta Fija").closest("li")!;
    expect(within(variable).getByText(eur(2451))).toBeInTheDocument();
    expect(within(variable).getByText(pct(70.52))).toBeInTheDocument();
    expect(within(fija).getByText(pct(29.48))).toBeInTheDocument();
  });

  it("lista los fondos en cartera con ISIN, valor, P&L y % actual", async () => {
    mockApi(portfolio);
    render(<Dashboard />);

    const row = (await screen.findByText("Vanguard Global Bond", { selector: "td" })).closest("tr")!;
    const cells = within(row);
    expect(cells.getByText("IE00B18GC888")).toBeInTheDocument();
    expect(cells.getByText("8,4321")).toBeInTheDocument(); // participaciones con decimales
    expect(cells.getByText(eur(1024.68))).toBeInTheDocument();
    expect(cells.getByText(eurSigned(-11.35))).toBeInTheDocument();
    expect(cells.getByText(pct(29.48))).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Nombre", "ISIN", "Participaciones", "Precio actual", "Valor total", "P&L", "% actual",
    ]);
  });

  it("con la cartera vacía muestra un mensaje en lugar del gráfico y la tabla", async () => {
    mockApi(empty);
    render(<Dashboard />);

    expect(await screen.findByText("Tu cartera está vacía")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("muestra un error si no puede cargar la cartera", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(500, { error: "boom" })));
    render(<Dashboard />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar la cartera");
  });
});

describe("Añadir transacción", () => {
  it("valida el formulario antes de enviar", async () => {
    const fetchMock = mockApi(portfolio);
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: /añadir transacción/i }));

    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Registrar compra" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("Selecciona un fondo");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/transactions", expect.anything());
  });

  it("registra una compra, cierra el modal y recarga la cartera", async () => {
    const posted: unknown[] = [];
    const fetchMock = mockApi(portfolio, (body) => {
      posted.push(body);
      return new Response(JSON.stringify({}), { status: 201 });
    });
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: /añadir transacción/i }));

    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("combobox", { name: "Fondo" }));
    await userEvent.click(await screen.findByRole("option", { name: "Vanguard Global Stock" }));

    // El precio es el NAV actual del fondo y no se puede editar.
    const price = dialog.getByLabelText("Precio participación (€)");
    expect(price).toHaveValue("512,34");
    expect(price).toHaveAttribute("readonly");
    await userEvent.type(price, "999");
    expect(price).toHaveValue("512,34");
    await userEvent.type(dialog.getByLabelText("Participaciones"), "2,5");
    expect(dialog.getByText(eur(2.5 * 512.34))).toBeInTheDocument();

    await userEvent.click(dialog.getByRole("button", { name: "Registrar compra" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posted).toEqual([{ fundId: "f1", type: "BUY", shares: 2.5, pricePerShare: 512.34 }]);
    const portfolioCalls = fetchMock.mock.calls.filter(([u]) => u === "/api/portfolio");
    expect(portfolioCalls).toHaveLength(2); // carga inicial + recarga tras guardar
  });

  it("permite indicar un importe en € y calcula las participaciones (importe ÷ precio)", async () => {
    const posted: unknown[] = [];
    mockApi(portfolio, (body) => {
      posted.push(body);
      return new Response(JSON.stringify({}), { status: 201 });
    });
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: /añadir transacción/i }));

    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("combobox", { name: "Fondo" }));
    await userEvent.click(await screen.findByRole("option", { name: "Vanguard Global Stock" }));
    await userEvent.click(dialog.getByRole("button", { name: "Importe (€)" }));
    await userEvent.type(dialog.getByLabelText("Importe (€)"), "1000");

    // 1000 / 512,34 = 1,95183… → 1,9518 participaciones (4 decimales)
    expect(dialog.getByText("1,9518")).toBeInTheDocument();

    await userEvent.click(dialog.getByRole("button", { name: "Registrar compra" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ fundId: "f1", type: "BUY", shares: 1.9518, pricePerShare: 512.34 });
  });

  it("al cambiar de modo conserva el valor equivalente", async () => {
    mockApi(portfolio);
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: /añadir transacción/i }));

    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("combobox", { name: "Fondo" }));
    await userEvent.click(await screen.findByRole("option", { name: "Vanguard Global Stock" }));
    await userEvent.type(dialog.getByLabelText("Participaciones"), "2");

    await userEvent.click(dialog.getByRole("button", { name: "Importe (€)" }));
    expect(dialog.getByLabelText("Importe (€)")).toHaveValue("1024.68"); // 2 × 512,34

    await userEvent.click(dialog.getByRole("button", { name: "Participaciones" }));
    expect(dialog.getByLabelText("Participaciones")).toHaveValue("2");
  });

  it("rechaza un importe con más de 2 decimales", async () => {
    mockApi(portfolio);
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: /añadir transacción/i }));

    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("combobox", { name: "Fondo" }));
    await userEvent.click(await screen.findByRole("option", { name: "Vanguard Global Stock" }));
    await userEvent.click(dialog.getByRole("button", { name: "Importe (€)" }));
    await userEvent.type(dialog.getByLabelText("Importe (€)"), "100,123");
    await userEvent.click(dialog.getByRole("button", { name: "Registrar compra" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("importe válido");
  });

  it("muestra el error del backend (p. ej. venta sin participaciones suficientes)", async () => {
    mockApi(portfolio, () =>
      new Response(
        JSON.stringify({
          error: "No tienes participaciones suficientes para esta venta",
          details: [{ field: "shares", message: "Disponibles: 4; solicitadas: 9" }],
        }),
        { status: 422 },
      ),
    );
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: /añadir transacción/i }));

    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("combobox", { name: "Operación" }));
    await userEvent.click(await screen.findByRole("option", { name: "Venta" }));
    await userEvent.click(dialog.getByRole("combobox", { name: "Fondo" }));
    await userEvent.click(await screen.findByRole("option", { name: "Vanguard Global Stock" }));
    await userEvent.type(dialog.getByLabelText("Participaciones"), "9");
    await userEvent.click(dialog.getByRole("button", { name: "Registrar venta" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("No tienes participaciones suficientes");
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // sigue abierto para corregir
  });
});
