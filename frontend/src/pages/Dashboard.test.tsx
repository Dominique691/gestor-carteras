import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fmt from "@/lib/format";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import type { Fund, Portfolio, PortfolioHistoryPoint, SyncSummary, TransactionItem } from "@/lib/types";
import Dashboard from "./Dashboard";

// Intl usa espacios no separables; Testing Library normaliza el DOM pero no el texto esperado.
const nbsp = (s: string) => s.replace(/ /g, " ");
const eur = (n: number) => nbsp(fmt.formatEur(n));
const eurSigned = (n: number) => nbsp(fmt.formatEurSigned(n));
const pct = (n: number) => nbsp(fmt.formatPercent(n));
const pctSigned = (n: number) => nbsp(fmt.formatPercentSigned(n));

const UPDATED_AT = "2026-10-02T09:30:00.000Z";

const funds: Fund[] = [
  { id: "f1", isin: "IE00B03HD191", name: "Vanguard Global Stock", category: "Renta Variable", currentNAV: 512.34, ticker: "EUNL.DE", lastPriceUpdate: UPDATED_AT },
  { id: "f2", isin: "IE00B18GC888", name: "Vanguard Global Bond", category: "Renta Fija", currentNAV: 121.45, ticker: null, lastPriceUpdate: null },
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
      shares: 4, averageBuyPrice: 600, currentNAV: 612.75, lastPriceUpdate: UPDATED_AT, currentValue: 2451, invested: 2400,
      pnl: 51, pnlPercentage: 2.13, portfolioPercentage: 70.52, targetPercentage: null,
    },
    {
      fundId: "f2", isin: "IE00B18GC888", name: "Vanguard Global Bond", category: "Renta Fija",
      shares: 8.4321, averageBuyPrice: 120, currentNAV: 121.45, lastPriceUpdate: null, currentValue: 1024.68, invested: 1013.33,
      pnl: -11.35, pnlPercentage: -1.12, portfolioPercentage: 29.48, targetPercentage: null,
    },
  ],
};
const empty: Portfolio = { ...portfolio, totalValue: 0, totalInvested: 0, pnl: 0, pnlPercentage: 0, positions: [] };

/** Resumen de POST /api/funds/sync-prices. */
const summary = (updated = 2, failed = 0): SyncSummary => ({
  total: updated + failed,
  updated,
  failed,
  skipped: 0,
  syncedAt: "2026-10-02T10:00:00.000Z",
  results: [],
});

const evolutionPoints: PortfolioHistoryPoint[] = [
  { date: "2026-09-30", invested: 0, currentValue: 0 },
  { date: "2026-10-01", invested: 3413.33, currentValue: 3413.33 },
  { date: "2026-10-02", invested: 3413.33, currentValue: 3475.68 },
];
/** Respuesta de GET /api/portfolio/history; cada test puede sustituirla. */
let evolutionResponse: () => Response | Promise<Response> = () => json(200, evolutionPoints);

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

/** fetch simulado: responde según URL; `onPost` captura las transacciones enviadas. */
function mockApi(
  data: Portfolio,
  onPost?: (body: unknown) => Response | Promise<Response>,
  history: TransactionItem[] = [],
  onSync?: () => Response | Promise<Response>,
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/portfolio") return json(200, data);
    if (url === "/api/portfolio/history") return evolutionResponse();
    if (url === "/api/funds") return json(200, funds);
    if (url === "/api/funds/sync-prices" && init?.method === "POST") return onSync ? onSync() : json(200, summary());
    if (url === "/api/transactions" && init?.method === "POST") {
      return onPost ? onPost(JSON.parse(String(init.body))) : json(201, {});
    }
    if (url === "/api/transactions") return json(200, history);
    return json(404, { error: "no encontrado" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  evolutionResponse = () => json(200, evolutionPoints);
});

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

  /** El valor de un KPI, localizado por la etiqueta de su tarjeta. */
  const kpi = async (title: string) => {
    const card = (await screen.findByText(title)).closest("[data-slot=card]") as HTMLElement;
    return within(card);
  };

  it("cada importe aparece bajo la etiqueta de su tarjeta", async () => {
    mockApi(portfolio);
    render(<Dashboard />);

    expect((await kpi("Patrimonio total")).getByText(eur(3475.68))).toBeInTheDocument();
    expect((await kpi("Inversión total")).getByText(eur(3413.33))).toBeInTheDocument();
    expect((await kpi("Ganancia / Pérdida")).getByText(eurSigned(62.35))).toBeInTheDocument();
    expect((await kpi("Rentabilidad")).getByText(pctSigned(1.83))).toBeInTheDocument();
  });

  it("una ganancia se muestra en verde con signo + y una pérdida en rojo con signo −", async () => {
    mockApi({ ...portfolio, pnl: 62.35, pnlPercentage: 1.83 });
    const { unmount } = render(<Dashboard />);
    const gain = (await kpi("Ganancia / Pérdida")).getByText(eurSigned(62.35));
    expect(gain.textContent).toContain("+");
    expect(gain.className).toContain("text-emerald");
    unmount();

    mockApi({ ...portfolio, pnl: -1234.56, pnlPercentage: -3.21 });
    render(<Dashboard />);
    const loss = (await kpi("Ganancia / Pérdida")).getByText(eurSigned(-1234.56));
    expect(loss.textContent).toMatch(/^[-−]/);
    expect(loss.className).toContain("text-red");
    expect((await kpi("Rentabilidad")).getByText(pctSigned(-3.21))).toBeInTheDocument();
  });

  it("formatea importes grandes con separador de miles y coma decimal", async () => {
    mockApi({ ...portfolio, totalValue: 1234567.89, totalInvested: 1000000, pnl: 234567.89, pnlPercentage: 23.46 });
    render(<Dashboard />);

    expect((await kpi("Patrimonio total")).getByText(eur(1234567.89))).toBeInTheDocument();
    expect(eur(1234567.89)).toBe("1.234.567,89 €");
    expect((await kpi("Inversión total")).getByText("1.000.000,00 €")).toBeInTheDocument();
  });

  it("con cero ganancia no muestra signo ni color de ganancia o pérdida", async () => {
    mockApi({ ...portfolio, pnl: 0, pnlPercentage: 0 });
    render(<Dashboard />);

    const zero = (await kpi("Ganancia / Pérdida")).getByText(eurSigned(0));
    expect(zero.textContent).not.toMatch(/[+\-−]/);
    expect(zero.className).not.toContain("text-emerald");
    expect(zero.className).not.toContain("text-red");
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

    expect(await screen.findByText("No se pudo cargar la cartera")).toBeInTheDocument();
  });
});

const tx = (n: number, over: Partial<TransactionItem> = {}): TransactionItem => ({
  id: `t${n}`,
  fundId: "f1",
  isin: "IE00B03HD191",
  fundName: "Vanguard Global Stock",
  type: "BUY",
  shares: 2.5,
  pricePerShare: 512.34,
  total: 1280.85,
  transactionDate: new Date(Date.UTC(2026, 8, 30 - n, 12)).toISOString(),
  ...over,
});

const renderWithToasts = () =>
  render(
    <ThemeProvider>
      <Dashboard />
      <Toaster />
    </ThemeProvider>,
  );
const syncButton = () => screen.findByRole("button", { name: "Actualizar precios de mercado" });
const syncCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([u, init]) => u === "/api/funds/sync-prices" && init?.method === "POST");
const portfolioCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([u]) => u === "/api/portfolio");

describe("Evolución del patrimonio", () => {
  it("muestra un esqueleto mientras carga y luego la gráfica bajo la distribución por categoría", async () => {
    let finish!: (r: Response) => void;
    evolutionResponse = () => new Promise<Response>((res) => (finish = res));
    mockApi(portfolio);
    render(<Dashboard />);

    expect(await screen.findByRole("status", { name: "Cargando evolución del patrimonio" })).toBeInTheDocument();
    expect(screen.getByText("Distribución por categoría")).toBeInTheDocument();

    finish(new Response(JSON.stringify(evolutionPoints), { status: 200 }));
    const title = await screen.findByText("Evolución del patrimonio");
    expect(screen.queryByRole("status", { name: "Cargando evolución del patrimonio" })).not.toBeInTheDocument();

    // Orden en el DOM: distribución → evolución → fondos en cartera.
    const distribution = screen.getByText("Distribución por categoría");
    const fundsTitle = screen.getByText("Fondos en cartera");
    expect(distribution.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(fundsTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("img", { name: /capital invertido es 3\.413,33.€ y el valor actual 3\.475,68.€/ })).toBeInTheDocument();
  });

  it("si falla la evolución avisa pero sigue mostrando la cartera", async () => {
    evolutionResponse = () => json(500, { error: "fallo" });
    mockApi(portfolio);
    render(<Dashboard />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar la evolución del patrimonio");
    expect(screen.getByText("Fondos en cartera")).toBeInTheDocument();
  });

  it("con la cartera vacía no muestra la gráfica", async () => {
    evolutionResponse = () => json(200, []);
    mockApi(empty);
    render(<Dashboard />);

    expect(await screen.findByText("Tu cartera está vacía")).toBeInTheDocument();
    expect(screen.queryByText("Evolución del patrimonio")).not.toBeInTheDocument();
  });
});

describe("Precios de mercado", () => {
  it("muestra junto al precio de cada fondo cuándo se actualizó por última vez", async () => {
    mockApi(portfolio);
    render(<Dashboard />);

    const stock = within((await screen.findByText("Vanguard Global Stock", { selector: "td" })).closest("tr")!);
    const bond = within((await screen.findByText("Vanguard Global Bond", { selector: "td" })).closest("tr")!);
    expect(stock.getByText(nbsp(fmt.formatDateTimeShort(UPDATED_AT)))).toBeInTheDocument();
    expect(bond.getByText("Sin actualizar")).toBeInTheDocument();
    // Y, arriba, la actualización más reciente de toda la cartera.
    expect(screen.getByText(/Precios de mercado actualizados el/)).toHaveTextContent(
      nbsp(fmt.formatDateTimeShort(UPDATED_AT)),
    );
  });

  it("indica que los precios están sin actualizar si ningún fondo se ha sincronizado nunca", async () => {
    mockApi({ ...portfolio, positions: portfolio.positions.map((p) => ({ ...p, lastPriceUpdate: null })) });
    render(<Dashboard />);

    expect(await screen.findByText("Precios de mercado sin actualizar")).toBeInTheDocument();
  });

  it("el botón llama al endpoint de sincronización, avisa con una notificación y recarga la cartera", async () => {
    const fetchMock = mockApi(portfolio, undefined, [], () => json(200, summary(2, 0)));
    renderWithToasts();

    await userEvent.click(await syncButton());

    expect(await screen.findByText("Precios actualizados: 2 fondos")).toBeInTheDocument();
    expect(syncCalls(fetchMock)).toHaveLength(1);
    expect(portfolioCalls(fetchMock)).toHaveLength(2); // carga inicial + recarga tras sincronizar
  });

  it("mientras sincroniza muestra un spinner y deshabilita el botón", async () => {
    let finish!: (r: Response) => void;
    const fetchMock = mockApi(portfolio, undefined, [], () => new Promise<Response>((res) => (finish = res)));
    renderWithToasts();

    const button = await syncButton();
    await userEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(button.querySelector("svg")).toHaveClass("animate-spin");
    await userEvent.click(button); // un segundo clic no lanza otra sincronización
    expect(syncCalls(fetchMock)).toHaveLength(1);

    finish(new Response(JSON.stringify(summary(1, 0)), { status: 200 }));
    expect(await screen.findByText("Precios actualizados: 1 fondo")).toBeInTheDocument();
    await waitFor(() => expect(button).toBeEnabled());
    expect(button.querySelector("svg")).not.toHaveClass("animate-spin");
  });

  it("si solo responden algunos fondos, avisa de los que se quedan con su último precio", async () => {
    mockApi(portfolio, undefined, [], () => json(200, summary(1, 1)));
    renderWithToasts();

    await userEvent.click(await syncButton());

    expect(
      await screen.findByText("1 fondo actualizado; 1 sin respuesta del proveedor (se mantiene su último precio)"),
    ).toBeInTheDocument();
  });

  it("si el proveedor no responde para ninguno, avisa de que se mantienen los últimos precios", async () => {
    mockApi(portfolio, undefined, [], () => json(200, summary(0, 2)));
    renderWithToasts();

    await userEvent.click(await syncButton());

    expect(
      await screen.findByText("No se pudieron obtener los precios de mercado. Se mantienen los últimos guardados."),
    ).toBeInTheDocument();
  });

  it("muestra el mensaje del backend si la sincronización no está disponible", async () => {
    mockApi(portfolio, undefined, [], () =>
      json(503, { error: "La sincronización de precios de mercado está desactivada" }),
    );
    renderWithToasts();

    await userEvent.click(await syncButton());

    expect(await screen.findByText("La sincronización de precios de mercado está desactivada")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Actualizar precios de mercado" })).toBeEnabled());
  });

  it("tras sincronizar muestra la nueva fecha de actualización", async () => {
    const NEW_DATE = "2026-10-02T11:45:00.000Z";
    let synced = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/funds/sync-prices") {
          synced = true;
          return json(200, summary(2, 0));
        }
        if (url === "/api/portfolio") {
          return json(200, {
            ...portfolio,
            positions: portfolio.positions.map((p) => (synced ? { ...p, lastPriceUpdate: NEW_DATE } : p)),
          });
        }
        if (url === "/api/transactions" && !init?.method) return json(200, []);
        return json(404, { error: "no encontrado" });
      }),
    );
    renderWithToasts();
    expect(await screen.findByText(/Precios de mercado actualizados el/)).toHaveTextContent(
      nbsp(fmt.formatDateTimeShort(UPDATED_AT)),
    );

    await userEvent.click(await syncButton());

    await waitFor(() =>
      expect(screen.getByText(/Precios de mercado actualizados el/)).toHaveTextContent(
        nbsp(fmt.formatDateTimeShort(NEW_DATE)),
      ),
    );
  });

  it("el formulario de transacción indica la fecha del precio del fondo elegido", async () => {
    mockApi(portfolio);
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: /añadir transacción/i }));
    const dialog = within(await screen.findByRole("dialog"));

    await userEvent.click(dialog.getByRole("combobox", { name: "Fondo" }));
    await userEvent.click(await screen.findByRole("option", { name: "Vanguard Global Stock" }));
    expect(dialog.getByText(/Precio de mercado actualizado el/)).toHaveTextContent(
      nbsp(fmt.formatDateTimeShort(UPDATED_AT)),
    );

    await userEvent.click(dialog.getByRole("combobox", { name: "Fondo" }));
    await userEvent.click(await screen.findByRole("option", { name: "Vanguard Global Bond" }));
    expect(dialog.getByText("Precio sin actualizar con datos de mercado")).toBeInTheDocument();
  });
});

describe("Historial de transacciones", () => {
  it("lista las operaciones con fecha, tipo, fondo, participaciones, precio e importe", async () => {
    mockApi(portfolio, undefined, [
      tx(1),
      tx(2, { id: "venta", type: "SELL", fundName: "Vanguard Global Bond", isin: "IE00B18GC888", shares: 5, pricePerShare: 120, total: 600 }),
    ]);
    render(<Dashboard />);

    const card = (await screen.findByText("Historial de transacciones")).closest("[data-slot=card]") as HTMLElement;
    const history = within(card);
    expect(history.getByText("2 operaciones, de la más reciente a la más antigua")).toBeInTheDocument();
    expect(history.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Fecha", "Operación", "Fondo", "Participaciones", "Precio", "Importe",
    ]);

    const rows = history.getAllByRole("row").slice(1); // sin la cabecera
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Compra")).toBeInTheDocument();
    expect(within(rows[0]).getByText("29/09/2026")).toBeInTheDocument();
    expect(within(rows[0]).getByText("2,5")).toBeInTheDocument();
    expect(within(rows[0]).getByText(eur(1280.85))).toBeInTheDocument();
    expect(within(rows[1]).getByText("Venta")).toBeInTheDocument();
    expect(within(rows[1]).getByText("IE00B18GC888")).toBeInTheDocument();
    expect(within(rows[1]).getByText(eur(600))).toBeInTheDocument();
  });

  it("muestra solo las 10 últimas y permite ver todas", async () => {
    mockApi(portfolio, undefined, Array.from({ length: 13 }, (_, i) => tx(i)));
    render(<Dashboard />);

    const card = (await screen.findByText("Historial de transacciones")).closest("[data-slot=card]") as HTMLElement;
    const history = within(card);
    expect(history.getAllByRole("row")).toHaveLength(11); // cabecera + 10

    await userEvent.click(history.getByRole("button", { name: "Ver todas (3 más)" }));
    expect(history.getAllByRole("row")).toHaveLength(14);

    await userEvent.click(history.getByRole("button", { name: "Ver solo las últimas" }));
    expect(history.getAllByRole("row")).toHaveLength(11);
  });

  it("sin operaciones no muestra la tarjeta de historial", async () => {
    mockApi(empty);
    render(<Dashboard />);

    await screen.findByText("Tu cartera está vacía");
    expect(screen.queryByText("Historial de transacciones")).not.toBeInTheDocument();
  });

  it("si falla el historial avisa pero sigue mostrando la cartera", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/portfolio") return json(200, portfolio);
      return json(500, { error: "boom" });
    }));
    render(<Dashboard />);

    expect(await screen.findByText("No se pudo cargar el historial de transacciones")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Indicadores" })).toBeInTheDocument();
  });

  it("se actualiza al registrar una transacción nueva", async () => {
    let created = false;
    const fetchMock = mockApi(portfolio, () => {
      created = true;
      return new Response(JSON.stringify({}), { status: 201 });
    });
    // tras crear, el backend devuelve ya la operación en el historial
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === "/api/transactions" && init?.method !== "POST" && created ? json(200, [tx(1)]) : base(url, init),
    );
    render(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: /añadir transacción/i }));

    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("combobox", { name: "Fondo" }));
    await userEvent.click(await screen.findByRole("option", { name: "Vanguard Global Stock" }));
    await userEvent.click(dialog.getByRole("button", { name: "Participaciones" }));
    await userEvent.type(dialog.getByLabelText("Participaciones"), "2,5");
    expect(screen.queryByText("Historial de transacciones")).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Registrar compra" }));

    expect(await screen.findByText("Historial de transacciones")).toBeInTheDocument();
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
    const posts = fetchMock.mock.calls.filter(([u, init]) => u === "/api/transactions" && init?.method === "POST");
    expect(posts).toHaveLength(0);
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
    await userEvent.click(dialog.getByRole("button", { name: "Participaciones" }));
    await userEvent.type(dialog.getByLabelText("Participaciones"), "2,5");
    expect(dialog.getByText(eur(2.5 * 512.34))).toBeInTheDocument();

    await userEvent.click(dialog.getByRole("button", { name: "Registrar compra" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posted).toEqual([{ fundId: "f1", type: "BUY", shares: 2.5, pricePerShare: 512.34 }]);
    const portfolioCalls = fetchMock.mock.calls.filter(([u]) => u === "/api/portfolio");
    expect(portfolioCalls).toHaveLength(2); // carga inicial + recarga tras guardar
  });

  it("por defecto pide el importe en € y calcula las participaciones (importe ÷ precio)", async () => {
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
    expect(dialog.getByRole("button", { name: "Importe (€)" })).toHaveAttribute("aria-pressed", "true");
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
    await userEvent.click(dialog.getByRole("button", { name: "Participaciones" }));
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
    await userEvent.click(dialog.getByRole("button", { name: "Participaciones" }));
    await userEvent.type(dialog.getByLabelText("Participaciones"), "9");
    await userEvent.click(dialog.getByRole("button", { name: "Registrar venta" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("No tienes participaciones suficientes");
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // sigue abierto para corregir
  });
});
