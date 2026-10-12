import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const state = {
    targets: 1,
    plan: null as Record<string, unknown> | null,
    runs: [] as Record<string, unknown>[],
  };
  return {
    state,
    prisma: {
      targetAllocation: { count: async () => state.targets },
      contributionPlan: {
        findUnique: async () => state.plan,
        upsert: async ({ create }: { create: Record<string, unknown> }) => (state.plan = { ...create }),
        deleteMany: async () => {
          state.plan = null;
          return { count: 1 };
        },
      },
      contributionRun: {
        findMany: async ({ where }: { where: { scheduledFor?: { gte: Date } } }) =>
          state.runs.filter((r) => !where.scheduledFor || (r.scheduledFor as Date) >= where.scheduledFor.gte),
      },
    },
  };
});
const service = vi.hoisted(() => ({ catchUpUser: vi.fn(async () => {}), runAllDue: vi.fn(async () => ({ executed: 2, failed: 0, users: 1 })) }));
vi.mock("../../db.js", () => ({ prisma: db.prisma }));
vi.mock("../../services/contributions.service.js", () => service);

import { buildApp } from "../../app.js";
import { Decimal } from "../../lib/decimal.js";

let app: FastifyInstance;
let auth: { authorization: string };
const put = (payload: object) => app.inject({ method: "PUT", url: "/api/contributions", payload, headers: auth });
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", "x".repeat(48));
  vi.stubEnv("CRON_SECRET", "secreto-del-cron");
  app = await buildApp({ logger: false });
  await app.ready();
  auth = { authorization: `Bearer ${app.jwt.sign({ sub: "u1", email: "ana@example.com" })}` };
});
afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  db.state.targets = 1;
  db.state.plan = null;
  db.state.runs = [];
  vi.clearAllMocks();
});

describe("PUT /api/contributions", () => {
  it("crea el plan, la primera ejecución es la fecha de inicio y la ejecuta si es hoy", async () => {
    const res = await put({ amount: "250.50", frequency: "QUARTERLY", startDate: today });

    expect(res.statusCode).toBe(200);
    expect(res.json().plan).toEqual({ amount: 250.5, frequency: "QUARTERLY", startDate: today, active: true, nextRunAt: today });
    expect(service.catchUpUser).toHaveBeenCalledWith("u1", expect.any(Function));
  });

  it("con una fecha de inicio pasada no pone al día los periodos anteriores", async () => {
    const res = await put({ amount: 100, frequency: "MONTHLY", startDate: "2020-01-01" });

    const next = new Date(`${res.json().plan.nextRunAt}T00:00:00Z`);
    expect(next.getUTCDate()).toBe(1);
    expect(res.json().plan.nextRunAt >= today).toBe(true);
  });

  it("no repite hoy una aportación que ya se ejecutó hoy", async () => {
    const scheduledFor = new Date(`${today}T00:00:00Z`);
    db.state.runs = [
      { id: "r1", scheduledFor, executedAt: scheduledFor, amount: new Decimal(100), status: "SUCCESS", purchases: 2, message: null },
    ];
    const res = await put({ amount: 100, frequency: "ANNUAL", startDate: today });

    expect(res.json().plan.nextRunAt > today).toBe(true);
    expect(res.json().runs).toEqual([expect.objectContaining({ scheduledFor: today, status: "SUCCESS", purchases: 2 })]);
  });

  it("pausado devuelve nextRunAt null", async () => {
    const res = await put({ amount: 100, frequency: "MONTHLY", startDate: today, active: false });
    expect(res.json().plan).toMatchObject({ active: false, nextRunAt: null });
  });

  it("exige objetivos guardados para activarlo", async () => {
    db.state.targets = 0;
    const res = await put({ amount: 100, frequency: "MONTHLY", startDate: today });

    expect(res.statusCode).toBe(422);
    expect(db.state.plan).toBeNull();
  });

  it("valida importe, frecuencia y fecha", async () => {
    const res = await put({ amount: "0.5", frequency: "WEEKLY", startDate: "15/11/2026" });

    expect(res.statusCode).toBe(400);
    expect(res.json().details.map((d: { field: string }) => d.field).sort()).toEqual(["amount", "frequency", "startDate"]);
  });

  it("requiere sesión", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/contributions", payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe("DELETE /api/contributions", () => {
  it("elimina el plan", async () => {
    await put({ amount: 100, frequency: "MONTHLY", startDate: today });
    const res = await app.inject({ method: "DELETE", url: "/api/contributions", headers: auth });

    expect(res.statusCode).toBe(204);
    expect(db.state.plan).toBeNull();
  });
});

describe("POST /api/cron/contributions/run-due", () => {
  it("con el secreto correcto ejecuta las aportaciones vencidas", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cron/contributions/run-due",
      headers: { authorization: "Bearer secreto-del-cron" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ executed: 2, failed: 0, users: 1 });
  });

  it("rechaza un secreto incorrecto o ausente", async () => {
    for (const headers of [{}, { authorization: "Bearer otro" }]) {
      const res = await app.inject({ method: "POST", url: "/api/cron/contributions/run-due", headers });
      expect(res.statusCode).toBe(401);
    }
    expect(service.runAllDue).not.toHaveBeenCalled();
  });
});
