import { describe, expect, it, vi } from "vitest";

// El módulo crea una instancia con Prisma al importarse; aquí se prueba solo la fábrica, sin base de datos.
vi.mock("../../db.js", () => ({ prisma: {} }));

import { Decimal } from "../../lib/decimal.js";
import {
  createMarketDataService,
  fetchQuote,
  QuoteError,
  type FundRow,
  type MarketDb,
} from "../marketData.service.js";

// ---------- utilidades ----------

const T0 = new Date("2026-10-02T10:00:00.000Z");
const OLD_NAV = "100.0000";
const OLD_DATE = new Date("2026-09-01T09:00:00.000Z");

const quoteResponse = (price: unknown, currency: unknown = "EUR") =>
  new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, currency } }] } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/** fetch que no responde nunca y solo termina cuando vence el timeout (se aborta la señal), como el real. */
const abortableHangingFetch: typeof fetch = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });

function fund(id: string, ticker: string | null, over: Partial<FundRow> = {}): FundRow {
  return { id, isin: `ISIN-${id}`, ticker, currentNAV: new Decimal(OLD_NAV), lastPriceUpdate: OLD_DATE, ...over };
}

/** Base de datos en memoria con la forma que necesita el servicio. */
function fakeDb(rows: FundRow[]) {
  const updates: { id: string; currentNAV: string; lastPriceUpdate: Date }[] = [];
  const db: MarketDb = {
    fund: {
      findMany: async () => rows.map((r) => ({ ...r })),
      update: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id)!;
        row.currentNAV = data.currentNAV;
        row.lastPriceUpdate = data.lastPriceUpdate;
        updates.push({ id: where.id, currentNAV: data.currentNAV.toFixed(4), lastPriceUpdate: data.lastPriceUpdate });
      },
    },
  };
  return { db, rows, updates };
}

function setup(rows: FundRow[], fetchImpl: typeof fetch, over: Partial<Parameters<typeof createMarketDataService>[0]> = {}) {
  const { db, updates } = fakeDb(rows);
  const clock = { now: new Date(T0) };
  const service = createMarketDataService({ db, fetchImpl, now: () => clock.now, timeoutMs: 50, ...over });
  return { service, rows, updates, clock };
}

const nav = (rows: FundRow[], id: string) => rows.find((r) => r.id === id)!.currentNAV.toFixed(4);

// ---------- fetchQuote ----------

describe("fetchQuote", () => {
  it("devuelve el precio y la divisa de una respuesta correcta", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL) => quoteResponse(130.38));
    const quote = await fetchQuote("EUNL.DE", { fetchImpl });

    expect(quote).toEqual({ price: 130.38, currency: "EUR" });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/chart/EUNL.DE?");
  });

  it.each([
    ["HTTP 429 (límite de cuota)", async () => new Response("Too Many Requests", { status: 429 }), "http"],
    ["error de red", async () => { throw new TypeError("fetch failed"); }, "network"],
    ["JSON incorrecto", async () => new Response("<html>", { status: 200 }), "invalid"],
    ["sin precio", async () => new Response(JSON.stringify({ chart: { result: null } }), { status: 200 }), "invalid"],
    ["precio cero", async () => quoteResponse(0), "invalid"],
    ["precio no numérico", async () => quoteResponse("130,38"), "invalid"],
    ["divisa distinta del euro", async () => quoteResponse(130.38, "USD"), "currency"],
  ])("lanza QuoteError ante %s", async (_name, impl, reason) => {
    await expect(fetchQuote("X", { fetchImpl: impl as unknown as typeof fetch })).rejects.toMatchObject({
      name: "QuoteError",
      reason,
    });
  });

  it("lanza QuoteError de tipo timeout cuando el proveedor no responde a tiempo", async () => {
    const started = Date.now();
    const err = await fetchQuote("X", { fetchImpl: abortableHangingFetch, timeoutMs: 30 }).catch((e) => e);

    expect(err).toBeInstanceOf(QuoteError);
    expect(err.reason).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

// ---------- syncPrices: éxito ----------

describe("syncPrices — la API responde", () => {
  it("guarda el nuevo NAV y la hora de actualización en la base de datos", async () => {
    const { service, rows, updates } = setup([fund("A", "EUNL.DE")], async () => quoteResponse(130.38));

    const summary = await service.syncPrices();

    expect(summary).toMatchObject({ total: 1, updated: 1, failed: 0, skipped: 0 });
    expect(summary.results[0]).toMatchObject({ status: "updated", price: 130.38, ticker: "EUNL.DE" });
    expect(nav(rows, "A")).toBe("130.3800");
    expect(rows[0].lastPriceUpdate).toEqual(T0);
    expect(updates).toHaveLength(1);
  });

  it("redondea el precio a 4 decimales (precisión del campo NUMERIC(12,4))", async () => {
    const { service, rows } = setup([fund("A", "X")], async () => quoteResponse(104.41549));
    await service.syncPrices();
    expect(nav(rows, "A")).toBe("104.4155");
  });

  it("no consulta los fondos sin ticker", async () => {
    const fetchImpl = vi.fn(async () => quoteResponse(50));
    const { service, rows } = setup([fund("A", null), fund("B", "VWCE.DE")], fetchImpl);

    const summary = await service.syncPrices();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(summary.results.find((r) => r.fundId === "A")).toMatchObject({ status: "skipped", reason: "no-ticker" });
    expect(nav(rows, "A")).toBe(OLD_NAV);
    expect(nav(rows, "B")).toBe("50.0000");
  });
});

// ---------- syncPrices: fallback a la última cotización guardada ----------

describe("syncPrices — la API falla (fallback a PostgreSQL)", () => {
  it.each([
    ["límite de cuota (HTTP 429)", async () => new Response("", { status: 429 }), "http"],
    ["sin conexión", async () => { throw new TypeError("fetch failed"); }, "network"],
    ["timeout", abortableHangingFetch, "timeout"],
    ["respuesta no válida", async () => new Response("{}", { status: 200 }), "invalid"],
  ])("ante %s no lanza error y conserva el último precio guardado", async (_name, impl, reason) => {
    const { service, rows, updates } = setup([fund("A", "EUNL.DE")], impl as unknown as typeof fetch);

    const summary = await service.syncPrices({ force: true });

    expect(summary).toMatchObject({ updated: 0, failed: 1 });
    expect(summary.results[0]).toMatchObject({ status: "failed", reason });
    // La base de datos no se ha modificado: sigue la última cotización conocida.
    expect(updates).toHaveLength(0);
    expect(nav(rows, "A")).toBe(OLD_NAV);
    expect(rows[0].lastPriceUpdate).toEqual(OLD_DATE);
  });

  it("con un fallo parcial actualiza los fondos que sí responden y conserva el resto", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("/GOOD") ? quoteResponse(77.7) : new Response("", { status: 500 }),
    );
    const { service, rows } = setup([fund("A", "GOOD"), fund("B", "BAD")], fetchImpl as unknown as typeof fetch);

    const summary = await service.syncPrices({ force: true });

    expect(summary).toMatchObject({ updated: 1, failed: 1 });
    expect(nav(rows, "A")).toBe("77.7000");
    expect(nav(rows, "B")).toBe(OLD_NAV);
  });

  it("un fallo al escribir en la base de datos tampoco rompe la sincronización", async () => {
    const rows = [fund("A", "X"), fund("B", "Y")];
    const db: MarketDb = {
      fund: {
        findMany: async () => rows,
        update: async ({ where }) => {
          if (where.id === "A") throw new Error("conexión perdida");
        },
      },
    };
    const service = createMarketDataService({ db, fetchImpl: async () => quoteResponse(10) });

    const summary = await service.syncPrices({ force: true });

    expect(summary.results.find((r) => r.fundId === "A")).toMatchObject({ status: "failed", reason: "database" });
    expect(summary.results.find((r) => r.fundId === "B")).toMatchObject({ status: "updated" });
  });
});

// ---------- caché (TTL) y periodo de espera ----------

describe("refreshIfStale — caché y reintentos", () => {
  it("no consulta la API mientras el precio esté vigente y sí cuando caduca", async () => {
    const fetchImpl = vi.fn(async () => quoteResponse(120));
    const { service, rows, clock } = setup([fund("A", "X", { lastPriceUpdate: new Date(T0.getTime() - 5 * 60_000) })], fetchImpl, {
      ttlMs: 15 * 60_000,
    });

    await service.refreshIfStale(); // actualizado hace 5 min: vigente
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(nav(rows, "A")).toBe(OLD_NAV);

    clock.now = new Date(T0.getTime() + 11 * 60_000); // ya han pasado 16 min
    await service.refreshIfStale();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(nav(rows, "A")).toBe("120.0000");
  });

  it("tras un fallo no reintenta hasta que pasa el periodo de espera, pero la actualización manual sí", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
    const { service, clock } = setup([fund("A", "X")], fetchImpl, { failureCooldownMs: 5 * 60_000 });

    await service.refreshIfStale();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await service.refreshIfStale(); // dentro del periodo de espera: no vuelve a consultar
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await service.syncPrices({ force: true }); // manual: ignora el periodo de espera
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    clock.now = new Date(T0.getTime() + 6 * 60_000);
    await service.refreshIfStale(); // pasado el periodo: reintenta
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("nunca lanza, ni siquiera si falla la lectura de la base de datos", async () => {
    const db: MarketDb = {
      fund: { findMany: async () => { throw new Error("base de datos caída"); }, update: async () => {} },
    };
    const log = vi.fn();
    const service = createMarketDataService({ db, log });

    await expect(service.refreshIfStale()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  it("no hace nada si los datos de mercado están desactivados", async () => {
    const fetchImpl = vi.fn(async () => quoteResponse(1));
    const { service } = setup([fund("A", "X")], fetchImpl, { enabled: false });

    await service.refreshIfStale();

    expect(service.enabled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("las peticiones simultáneas comparten una sola ronda de consultas", async () => {
    const fetchImpl = vi.fn(async () => quoteResponse(55));
    const { service } = setup([fund("A", "X"), fund("B", "Y")], fetchImpl, {});

    await Promise.all([service.refreshIfStale(), service.refreshIfStale(), service.syncPrices()]);

    expect(fetchImpl).toHaveBeenCalledTimes(2); // un fondo = una consulta, no tres
  });
});
