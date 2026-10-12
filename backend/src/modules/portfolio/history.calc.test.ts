import { describe, expect, it } from "vitest";
import { Decimal } from "../../lib/decimal.js";
import { buildHistory } from "./history.calc.js";
import type { TxInput } from "./portfolio.calc.js";

const tx = (id: string, fundId: string, type: "BUY" | "SELL", shares: number, price: number, day: number): TxInput => ({
  id,
  fundId,
  type,
  shares: new Decimal(shares),
  pricePerShare: new Decimal(price),
  transactionDate: new Date(Date.UTC(2026, 0, day, 10)),
});
const navs = (entries: Record<string, number>) =>
  new Map(Object.entries(entries).map(([id, nav]) => [id, new Decimal(nav)]));
const today = (day: number) => new Date(Date.UTC(2026, 0, day, 18));

describe("buildHistory", () => {
  it("devuelve una serie vacía sin operaciones", () => {
    expect(buildHistory([], new Map(), today(10))).toEqual([]);
  });

  it("arranca a 0 el día anterior a la primera compra e interpola hasta el NAV actual", () => {
    const points = buildHistory([tx("a", "f1", "BUY", 10, 100, 1)], navs({ f1: 110 }), today(3));
    expect(points).toEqual([
      { date: "2025-12-31", invested: 0, currentValue: 0 },
      { date: "2026-01-01", invested: 1000, currentValue: 1000 },
      { date: "2026-01-02", invested: 1000, currentValue: 1050 },
      { date: "2026-01-03", invested: 1000, currentValue: 1100 },
    ]);
  });

  it("acumula compras de varios fondos y descuenta el coste medio vendido", () => {
    const points = buildHistory(
      [tx("a", "f1", "BUY", 2, 500, 1), tx("b", "f2", "BUY", 10, 100, 2), tx("c", "f1", "SELL", 1, 520, 3)],
      navs({ f1: 520, f2: 100 }),
      today(3),
    );
    expect(points.at(-1)).toEqual({ date: "2026-01-03", invested: 1500, currentValue: 1520 });
    expect(points.map((p) => p.date)).toEqual(["2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("pasa a puntos semanales en historiales largos sin perder los días con operaciones ni el último", () => {
    const points = buildHistory(
      [tx("a", "f1", "BUY", 1, 100, 1), tx("b", "f1", "BUY", 1, 100, 200)],
      navs({ f1: 100 }),
      today(600),
    );
    expect(points.length).toBeLessThan(120);
    const dates = points.map((p) => p.date);
    expect(dates).toContain("2026-07-19"); // día 200
    expect(points.at(-1)).toEqual({ date: "2027-08-23", invested: 200, currentValue: 200 });
  });
});
