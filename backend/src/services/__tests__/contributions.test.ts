import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "../../lib/decimal.js";

// Base de datos en memoria con lo que usa contributions.service.
const db = vi.hoisted(() => {
  interface Plan {
    userId: string;
    amount: unknown;
    frequency: string;
    startDate: Date;
    nextRunAt: Date;
    active: boolean;
  }
  const state = {
    plans: new Map<string, Plan>(),
    runs: [] as Record<string, unknown>[],
    txs: [] as Record<string, unknown>[],
    funds: [] as { id: string; ticker: string | null; currentNAV: unknown }[],
  };
  const tx = {
    $queryRaw: async () => [],
    contributionPlan: {
      findUnique: async ({ where }: { where: { userId: string } }) => state.plans.get(where.userId) ?? null,
      update: async ({ where, data }: { where: { userId: string }; data: Partial<Plan> }) =>
        Object.assign(state.plans.get(where.userId)!, data),
    },
    contributionRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        // Imita la restricción única (userId, scheduledFor).
        if (state.runs.some((r) => r.userId === data.userId && (r.scheduledFor as Date).getTime() === (data.scheduledFor as Date).getTime())) {
          throw new Error("Unique constraint failed");
        }
        state.runs.push(data);
        return data;
      },
    },
    fund: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => state.funds.filter((f) => where.id.in.includes(f.id)),
    },
    transaction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.txs.push(data);
        return data;
      },
    },
  };
  return {
    state,
    prisma: {
      ...tx,
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      contributionPlan: {
        ...tx.contributionPlan,
        findMany: async () =>
          [...state.plans.values()].filter((p) => p.active && p.nextRunAt <= new Date()).map((p) => ({ userId: p.userId })),
      },
    },
  };
});
const rebalance = vi.hoisted(() => ({ getRebalance: vi.fn() }));
vi.mock("../../db.js", () => ({ prisma: db.prisma }));
vi.mock("../marketData.service.js", () => ({ marketData: { refreshIfStale: async () => {} } }));
vi.mock("../rebalance.service.js", async () => {
  const actual = await vi.importActual<typeof import("../rebalance.service.js")>("../rebalance.service.js");
  return { NoTargetsError: actual.NoTargetsError, getRebalance: rebalance.getRebalance };
});

import { NoTargetsError } from "../rebalance.service.js";
import { runAllDue, runDueForUser } from "../contributions.service.js";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const USER = "u1";

function seedPlan(over: Partial<{ nextRunAt: Date; active: boolean; frequency: string }> = {}) {
  db.state.plans.set(USER, {
    userId: USER,
    amount: new Decimal(300),
    frequency: "MONTHLY",
    startDate: day("2026-08-15"),
    nextRunAt: day("2026-10-15"),
    active: true,
    ...over,
  });
}

beforeEach(() => {
  db.state.plans.clear();
  db.state.runs.length = 0;
  db.state.txs.length = 0;
  db.state.funds.splice(0, db.state.funds.length,
    { id: "world", ticker: "EUNL.DE", currentNAV: new Decimal(100) },
    { id: "bonos", ticker: "AGGH.DE", currentNAV: new Decimal(50) },
  );
  rebalance.getRebalance.mockResolvedValue({
    items: [
      { fundId: "world", affordableContribution: 200, targetPercentage: 60 },
      { fundId: "bonos", affordableContribution: 100, targetPercentage: 40 },
    ],
  });
});
afterEach(() => vi.clearAllMocks());

describe("aportaciones automáticas", () => {
  it("no hace nada antes de la fecha programada", async () => {
    seedPlan();
    expect(await runDueForUser(USER, new Date("2026-10-14T23:59:00Z"))).toEqual({ executed: 0, failed: 0 });
    expect(db.state.txs).toHaveLength(0);
  });

  it("al llegar la fecha crea las compras al precio actual, registra la ejecución y programa la siguiente", async () => {
    seedPlan();
    const now = new Date("2026-10-15T08:00:00Z");
    expect(await runDueForUser(USER, now)).toEqual({ executed: 1, failed: 0 });

    expect(db.state.txs.map((t) => [t.fundId, String(t.shares), String(t.pricePerShare), t.type])).toEqual([
      ["world", "2", "100", "BUY"],
      ["bonos", "2", "50", "BUY"],
    ]);
    expect(db.state.txs[0].transactionDate).toEqual(now);
    expect(db.state.runs).toEqual([
      expect.objectContaining({ scheduledFor: day("2026-10-15"), status: "SUCCESS", purchases: 2, message: null }),
    ]);
    expect(db.state.plans.get(USER)!.nextRunAt).toEqual(day("2026-11-15"));
  });

  it("pone al día varios periodos atrasados, cada uno una vez", async () => {
    seedPlan({ nextRunAt: day("2026-08-15") });
    const now = new Date("2026-10-20T08:00:00Z");
    expect(await runDueForUser(USER, now)).toEqual({ executed: 3, failed: 0 });
    expect(db.state.runs.map((r) => (r.scheduledFor as Date).toISOString().slice(0, 10))).toEqual([
      "2026-08-15", "2026-09-15", "2026-10-15",
    ]);
    // Una segunda pasada no repite nada.
    expect(await runDueForUser(USER, now)).toEqual({ executed: 0, failed: 0 });
    expect(db.state.txs).toHaveLength(6);
  });

  it("un plan pausado no se ejecuta", async () => {
    seedPlan({ active: false, nextRunAt: day("2026-01-01") });
    expect(await runDueForUser(USER, new Date("2026-10-20T08:00:00Z"))).toEqual({ executed: 0, failed: 0 });
  });

  it("sin objetivos registra el fallo y pasa a la siguiente fecha en lugar de reintentar sin fin", async () => {
    seedPlan();
    rebalance.getRebalance.mockRejectedValue(new NoTargetsError());

    expect(await runDueForUser(USER, new Date("2026-10-15T08:00:00Z"))).toEqual({ executed: 0, failed: 1 });
    expect(db.state.txs).toHaveLength(0);
    expect(db.state.runs[0]).toMatchObject({ status: "FAILED", message: "No hay porcentajes objetivo guardados" });
    expect(db.state.plans.get(USER)!.nextRunAt).toEqual(day("2026-11-15"));
  });

  it("solo compra fondos que cotizan", async () => {
    seedPlan();
    db.state.funds[1].ticker = null;

    await runDueForUser(USER, new Date("2026-10-15T08:00:00Z"));
    expect(db.state.txs.map((t) => [t.fundId, String(t.shares)])).toEqual([["world", "3"]]);
  });

  it("runAllDue procesa a todos los usuarios con aportaciones vencidas", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-15T08:00:00Z") });
    try {
      seedPlan();
      expect(await runAllDue(new Date())).toEqual({ executed: 1, failed: 0, users: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});
