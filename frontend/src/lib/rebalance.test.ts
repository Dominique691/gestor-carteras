import { describe, expect, it } from "vitest";
import { computeRebalance, parseDecimal, planPurchases } from "./rebalance";

const f = (fundId: string, currentValue: number, targetPercentage: number) => ({ fundId, currentValue, targetPercentage });
const get = (r: ReturnType<typeof computeRebalance>, id: string) => r.rows.find((x) => x.fundId === id)!;
const sum = (r: ReturnType<typeof computeRebalance>) => r.rows.reduce((s, x) => s + Math.round(x.contribution * 100), 0);

describe("computeRebalance", () => {
  it("cartera 70/30 en objetivo y 0 €: no sugiere nada", () => {
    const r = computeRebalance([f("A", 7000, 70), f("B", 3000, 30)], 0);
    expect(r.rows.every((x) => x.contribution === 0)).toBe(true);
    expect(get(r, "A")).toMatchObject({ currentPercentage: 70, targetValue: 7000 });
  });

  it("con 1.000 € prioriza el infraponderado", () => {
    const r = computeRebalance([f("A", 8000, 70), f("B", 2000, 30)], 1000);
    expect(r.targetTotal).toBe(11000);
    expect(get(r, "B").contribution).toBe(1000);
    expect(get(r, "A").contribution).toBe(0);
    expect(r.rows[0].fundId).toBe("B");
  });

  it("reparte según objetivos cuando ambos están por debajo", () => {
    const r = computeRebalance([f("A", 7000, 70), f("B", 3000, 30)], 1000);
    expect(get(r, "A").contribution).toBe(700);
    expect(get(r, "B").contribution).toBe(300);
  });

  it("nunca sugiere importes negativos y suma exactamente la aportación", () => {
    const r = computeRebalance([f("A", 9000, 50), f("B", 600, 25), f("C", 400, 25)], 500);
    for (const x of r.rows) expect(x.contribution).toBeGreaterThanOrEqual(0);
    expect(get(r, "A").contribution).toBe(0);
    expect(sum(r)).toBe(50000);
  });

  it("suma exacta en céntimos aunque el reparto sea periódico (1/3 cada uno)", () => {
    const r = computeRebalance([f("A", 0, 33.33), f("B", 0, 33.33), f("C", 0, 33.34)], 100);
    expect(sum(r)).toBe(10000);
  });

  it("cartera vacía: reparte toda la aportación según objetivos", () => {
    const r = computeRebalance([f("A", 0, 60), f("B", 0, 40)], 1000);
    expect(get(r, "A").contribution).toBe(600);
    expect(get(r, "B").contribution).toBe(400);
    expect(get(r, "A").currentPercentage).toBe(0);
  });

  it("un fondo con posición y objetivo 0 % no recibe nada", () => {
    const r = computeRebalance([f("A", 1000, 0), f("B", 0, 100)], 500);
    expect(get(r, "A").contribution).toBe(0);
    expect(get(r, "B").contribution).toBe(500);
  });
});

describe("planPurchases", () => {
  it("convierte importes en participaciones al NAV y omite los de 0 €", () => {
    const r = computeRebalance([f("A", 8000, 70), f("B", 2000, 30)], 1000);
    const plan = planPurchases(r.rows, new Map([["A", 100], ["B", 512.34]]));
    expect(plan).toEqual([{ fundId: "B", amount: 1000, shares: 1.9518, pricePerShare: 512.34 }]);
  });
});

describe("parseDecimal", () => {
  it("acepta coma o punto y rechaza exceso de decimales o texto", () => {
    expect(parseDecimal("12,5", 2)).toBe(12.5);
    expect(parseDecimal("12.34", 2)).toBe(12.34);
    expect(parseDecimal("12.345", 2)).toBeNull();
    expect(parseDecimal("abc", 2)).toBeNull();
    expect(parseDecimal("-1", 2)).toBeNull();
    expect(parseDecimal("", 2)).toBeNull();
  });
});
