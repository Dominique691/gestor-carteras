import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Base de datos en memoria con lo justo para POST /api/transactions (usa una transacción interactiva de Prisma).
const db = vi.hoisted(() => {
  interface Fund { id: string; isin: string; name: string; ticker: string | null }
  interface Tx {
    id: string;
    userId: string;
    fundId: string;
    type: "BUY" | "SELL";
    shares: unknown;
    pricePerShare: unknown;
    transactionDate: Date;
  }
  const funds: Fund[] = [];
  const txs: Tx[] = [];
  const tx = {
    $queryRaw: async () => [],
    fund: { findUnique: async ({ where }: { where: { id: string } }) => funds.find((f) => f.id === where.id) ?? null },
    transaction: {
      create: async ({ data }: { data: Omit<Tx, "id"> }) => {
        const row = { id: `tx-${txs.length + 1}`, ...data };
        txs.push(row);
        return { ...row, fund: funds.find((f) => f.id === data.fundId)! };
      },
      findMany: async ({ where }: { where: { userId: string; fundId: string } }) =>
        txs.filter((t) => t.userId === where.userId && t.fundId === where.fundId),
    },
  };
  return {
    funds,
    txs,
    prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
  };
});
vi.mock("../../db.js", () => ({ prisma: db.prisma }));

import { buildApp } from "../../app.js";
import { Decimal } from "../../lib/decimal.js";

const USER = "11111111-1111-4111-8111-111111111111";
const TRADED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEGACY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let app: FastifyInstance;
let auth: { authorization: string };

const post = (payload: object) => app.inject({ method: "POST", url: "/api/transactions", headers: auth, payload });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", "x".repeat(48));
  app = await buildApp({ logger: false });
  await app.ready();
  auth = { authorization: `Bearer ${app.jwt.sign({ sub: USER, email: "ana@example.com" })}` };
});

afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  db.funds.length = 0;
  db.txs.length = 0;
  db.funds.push(
    { id: TRADED, isin: "IE00B4L5Y983", name: "iShares Core MSCI World", ticker: "EUNL.DE" },
    { id: LEGACY, isin: "IE00B18GC888", name: "Fondo heredado sin cotización", ticker: null },
  );
});

describe("POST /api/transactions — solo fondos que cotizan", () => {
  it("permite comprar un fondo con ticker", async () => {
    const res = await post({ fundId: TRADED, type: "BUY", shares: 2, pricePerShare: 130.38 });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ fundId: TRADED, type: "BUY", shares: 2, total: 260.76 });
    expect(db.txs).toHaveLength(1);
  });

  it("rechaza con 422 comprar un fondo que no cotiza y no registra nada", async () => {
    const res = await post({ fundId: LEGACY, type: "BUY", shares: 1, pricePerShare: 121.45 });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain("no cotiza");
    expect(db.txs).toHaveLength(0);
  });

  it("sigue permitiendo vender una posición heredada de un fondo sin cotización", async () => {
    db.txs.push({
      id: "previa",
      userId: USER,
      fundId: LEGACY,
      type: "BUY",
      shares: new Decimal(10),
      pricePerShare: new Decimal(100),
      transactionDate: new Date("2026-01-01T00:00:00Z"),
    });

    const res = await post({ fundId: LEGACY, type: "SELL", shares: 4, pricePerShare: 120 });

    expect(res.statusCode).toBe(201);
  });

  it("responde 404 si el fondo no existe", async () => {
    const res = await post({ fundId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", type: "BUY", shares: 1, pricePerShare: 1 });

    expect(res.statusCode).toBe(404);
  });
});
