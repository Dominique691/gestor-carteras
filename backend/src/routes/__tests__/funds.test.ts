import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Base de datos en memoria: la usan tanto las rutas como el servicio de precios (ambos importan `prisma`).
const db = vi.hoisted(() => {
  interface Row {
    id: string;
    isin: string;
    name: string;
    category: string;
    ticker: string | null;
    currentNAV: { toFixed(d: number): string; toNumber(): number; toDecimalPlaces(d: number, r?: number): { toNumber(): number } };
    lastPriceUpdate: Date | null;
  }
  const funds: Row[] = [];
  return {
    funds,
    prisma: {
      fund: {
        // Imita el filtro `where: { ticker: { not: null } }` que usa el catálogo; sin filtro devuelve todo.
        async findMany(args?: { where?: { ticker?: { not: null } } }) {
          const rows = args?.where?.ticker ? funds.filter((f) => f.ticker !== null) : funds;
          return rows.map((f) => ({ ...f }));
        },
        async update({ where, data }: { where: { id: string }; data: Partial<Row> }) {
          Object.assign(funds.find((f) => f.id === where.id)!, data);
        },
      },
    },
  };
});
vi.mock("../../db.js", () => ({ prisma: db.prisma }));

import { buildApp } from "../../app.js";
import { Decimal } from "../../lib/decimal.js";

let app: FastifyInstance;
let auth: { authorization: string };
let seq = 0;

const OLD_DATE = new Date("2026-09-01T09:00:00.000Z");
const quote = (price: number, currency = "EUR") =>
  new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, currency } }] } }), { status: 200 });

/** Cada test usa fondos nuevos (ids propios) para que el periodo de espera por fallos no se arrastre entre tests. */
function addFund(over: Partial<(typeof db.funds)[number]> = {}) {
  const n = ++seq;
  const row = {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    isin: `ISIN${n}`,
    name: `Fondo ${n}`,
    category: "Renta Variable",
    ticker: `TCK${n}.DE`,
    currentNAV: new Decimal("100"),
    lastPriceUpdate: OLD_DATE as Date | null,
    ...over,
  };
  db.funds.push(row as (typeof db.funds)[number]);
  return row;
}

const get = (url: string, headers = auth) => app.inject({ method: "GET", url, headers });
const post = (url: string, headers = auth) => app.inject({ method: "POST", url, headers });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", "x".repeat(48));
  app = await buildApp({ logger: false });
  await app.ready();
  auth = { authorization: `Bearer ${app.jwt.sign({ sub: "11111111-1111-4111-8111-111111111111", email: "ana@example.com" })}` };
});

afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {}); // el servicio registra los fallos del proveedor
  db.funds.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => quote(100)));
});

describe("GET /api/funds — precios de mercado", () => {
  it("exige autenticación", async () => {
    expect((await get("/api/funds", {} as typeof auth)).statusCode).toBe(401);
  });

  it("si la API responde, devuelve el catálogo con el precio y la hora actualizados", async () => {
    const fund = addFund();
    vi.stubGlobal("fetch", vi.fn(async () => quote(135.5)));

    const res = await get("/api/funds");

    expect(res.statusCode).toBe(200);
    const [item] = res.json();
    expect(item).toMatchObject({ id: fund.id, ticker: fund.ticker, currentNAV: 135.5 });
    expect(new Date(item.lastPriceUpdate).getTime()).toBeGreaterThan(OLD_DATE.getTime());
    expect(fund.currentNAV.toFixed(4)).toBe("135.5000"); // guardado también en la base de datos
  });

  it.each([
    ["límite de cuota (429)", () => new Response("", { status: 429 })],
    ["error de servidor (500)", () => new Response("", { status: 500 })],
    ["respuesta sin precio", () => new Response("{}", { status: 200 })],
    ["precio en otra divisa", () => quote(150, "USD")],
  ])("si la API falla (%s) devuelve la última cotización guardada, sin error", async (_name, response) => {
    addFund();
    vi.stubGlobal("fetch", vi.fn(async () => response()));

    const res = await get("/api/funds");

    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ currentNAV: 100, lastPriceUpdate: OLD_DATE.toISOString() });
  });

  it("si no hay conexión devuelve la última cotización guardada, sin error", async () => {
    addFund();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));

    const res = await get("/api/funds");

    expect(res.statusCode).toBe(200);
    expect(res.json()[0].currentNAV).toBe(100);
  });

  it("no consulta la API si el precio se actualizó hace poco", async () => {
    addFund({ lastPriceUpdate: new Date() });
    const fetchMock = vi.fn(async () => quote(999));
    vi.stubGlobal("fetch", fetchMock);

    const res = await get("/api/funds");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.json()[0].currentNAV).toBe(100);
  });

  it("el catálogo solo incluye fondos que cotizan: los registros sin ticker no se ofrecen ni se consultan", async () => {
    const traded = addFund();
    addFund({ ticker: null, lastPriceUpdate: null, isin: "LEGACY" });
    const fetchMock = vi.fn(async () => quote(120));
    vi.stubGlobal("fetch", fetchMock);

    const res = await get("/api/funds");

    expect(res.statusCode).toBe(200);
    expect(res.json().map((f: { id: string }) => f.id)).toEqual([traded.id]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // solo el fondo con ticker
  });
});

describe("POST /api/funds/sync-prices", () => {
  it("exige autenticación", async () => {
    expect((await post("/api/funds/sync-prices", {} as typeof auth)).statusCode).toBe(401);
  });

  it("fuerza la actualización de todo el catálogo, incluso con precios recientes", async () => {
    const withTicker = addFund({ lastPriceUpdate: new Date() }); // vigente: el refresco normal lo saltaría
    const noTicker = addFund({ ticker: null });
    vi.stubGlobal("fetch", vi.fn(async () => quote(142.76)));

    const res = await post("/api/funds/sync-prices");

    expect(res.statusCode).toBe(200);
    const summary = res.json();
    expect(summary).toMatchObject({ total: 2, updated: 1, failed: 0, skipped: 1 });
    expect(summary.results.find((r: { fundId: string }) => r.fundId === withTicker.id)).toMatchObject({
      status: "updated",
      price: 142.76,
    });
    expect(summary.results.find((r: { fundId: string }) => r.fundId === noTicker.id)).toMatchObject({
      status: "skipped",
      reason: "no-ticker",
    });
    expect(withTicker.currentNAV.toFixed(4)).toBe("142.7600");
  });

  it("acepta un POST vacío con cualquier Content-Type (PowerShell, Postman…) en lugar de responder 415", async () => {
    addFund();

    for (const contentType of ["application/x-www-form-urlencoded", "text/plain", "application/json"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/funds/sync-prices",
        headers: { ...auth, "content-type": contentType },
      });
      expect(res.statusCode, contentType).toBe(200);
    }
  });

  it("si el proveedor falla responde 200 con el detalle del fallo y conserva los precios", async () => {
    const fund = addFund();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));

    const res = await post("/api/funds/sync-prices");

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ updated: 0, failed: 1 });
    expect(res.json().results[0]).toMatchObject({ status: "failed", reason: "http" });
    expect(fund.currentNAV.toFixed(4)).toBe("100.0000");
    expect(fund.lastPriceUpdate).toEqual(OLD_DATE);
  });
});
