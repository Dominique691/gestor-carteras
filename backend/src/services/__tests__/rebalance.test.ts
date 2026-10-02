import { describe, expect, it, vi } from "vitest";

// El servicio importa Prisma; aquí solo se prueba la lógica pura, sin base de datos.
vi.mock("../../db.js", () => ({ prisma: {} }));

import { Decimal } from "../../lib/decimal.js";
import { computeRebalance } from "../rebalance.service.js";

const fund = (id: string, currentValue: number, targetPercentage: number) => ({
  fundId: id,
  isin: `ISIN-${id}`,
  name: `Fondo ${id}`,
  currentValue: new Decimal(currentValue),
  targetPercentage: new Decimal(targetPercentage),
});

type Result = ReturnType<typeof computeRebalance>;
const byId = (r: Result, id: string) => r.items.find((i) => i.fundId === id)!;
const sumAffordable = (r: Result) => r.items.reduce((s, i) => s + i.affordableContribution, 0);

describe("computeRebalance", () => {
  it("cartera 70/30 ya en objetivo y 0 € de aportación: no sugiere nada", () => {
    const r = computeRebalance([fund("A", 7000, 70), fund("B", 3000, 30)], new Decimal(0));

    expect(r.totalValue).toBe(10000);
    expect(r.targetTotal).toBe(10000);
    expect(byId(r, "A")).toMatchObject({
      currentPercentage: 70,
      targetPercentage: 70,
      currentValue: 7000,
      targetValue: 7000,
      affordableContribution: 0,
    });
    expect(byId(r, "B")).toMatchObject({
      currentPercentage: 30,
      targetPercentage: 30,
      currentValue: 3000,
      targetValue: 3000,
      affordableContribution: 0,
    });
  });

  it("con 1.000 € de aportación prioriza el activo infraponderado", () => {
    // 80/20 actual frente a un objetivo 70/30: B está infraponderado.
    const r = computeRebalance([fund("A", 8000, 70), fund("B", 2000, 30)], new Decimal(1000));

    expect(r.targetTotal).toBe(11000);
    expect(byId(r, "A").targetValue).toBe(7700);
    expect(byId(r, "B").targetValue).toBe(3300);
    expect(byId(r, "B").affordableContribution).toBe(1000);
    expect(byId(r, "A").affordableContribution).toBe(0);
    expect(r.items[0].fundId).toBe("B"); // el más prioritario va primero
  });

  it("con ambos activos por debajo del objetivo reparte la aportación según los porcentajes", () => {
    const r = computeRebalance([fund("A", 7000, 70), fund("B", 3000, 30)], new Decimal(1000));

    expect(byId(r, "A").affordableContribution).toBe(700);
    expect(byId(r, "B").affordableContribution).toBe(300);
  });

  it("nunca genera aportaciones negativas ni exige vender un activo sobreponderado", () => {
    // A pesa 90 % frente a un objetivo de 50 %: su valor objetivo queda por debajo del actual.
    const r = computeRebalance([fund("A", 9000, 50), fund("B", 1000, 50)], new Decimal(500));

    expect(byId(r, "A").targetValue).toBeLessThan(byId(r, "A").currentValue);
    for (const item of r.items) expect(item.affordableContribution).toBeGreaterThanOrEqual(0);
    expect(byId(r, "A").affordableContribution).toBe(0);
    // Toda la aportación va al infraponderado, sin exceder el presupuesto.
    expect(byId(r, "B").affordableContribution).toBe(500);
    expect(sumAffordable(r)).toBeCloseTo(500, 2);
  });

  it("con 0 € de aportación y activos desviados tampoco sugiere compras ni ventas", () => {
    const r = computeRebalance([fund("A", 9000, 50), fund("B", 1000, 50)], new Decimal(0));

    for (const item of r.items) expect(item.affordableContribution).toBe(0);
  });

  it("cartera vacía: reparte la aportación íntegra según los objetivos", () => {
    const r = computeRebalance([fund("A", 0, 60), fund("B", 0, 40)], new Decimal(1000));

    expect(r.totalValue).toBe(0);
    expect(byId(r, "A").currentPercentage).toBe(0);
    expect(byId(r, "A").affordableContribution).toBe(600);
    expect(byId(r, "B").affordableContribution).toBe(400);
  });
});
