import { describe, expect, it } from "vitest";
import { Decimal } from "../../lib/decimal.js";
import {
  addMonthsUTC,
  allocateContribution,
  firstOccurrence,
  nextOccurrenceAfter,
  NoTradeableFundsError,
  type AllocationCandidate,
} from "./contributions.calc.js";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("calendario de aportaciones", () => {
  it("suma meses usando el último día cuando el mes destino es más corto", () => {
    expect(iso(addMonthsUTC(day("2026-01-31"), 1))).toBe("2026-02-28");
    expect(iso(addMonthsUTC(day("2028-01-31"), 1))).toBe("2028-02-29");
    expect(iso(addMonthsUTC(day("2026-11-15"), 3))).toBe("2027-02-15");
  });

  it("calcula cada fecha desde el inicio: el día 31 no se queda en 28 tras febrero", () => {
    const start = day("2026-01-31");
    let d = start;
    const dates = [];
    for (let i = 0; i < 3; i++) {
      d = nextOccurrenceAfter(start, "MONTHLY", d);
      dates.push(iso(d));
    }
    expect(dates).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it.each([
    ["MONTHLY", "2026-11-10"],
    ["QUARTERLY", "2027-01-10"],
    ["SEMIANNUAL", "2027-04-10"],
    ["ANNUAL", "2027-10-10"],
  ] as const)("frecuencia %s: siguiente fecha tras la del inicio", (frequency, expected) => {
    expect(iso(nextOccurrenceAfter(day("2026-10-10"), frequency, day("2026-10-10")))).toBe(expected);
  });

  it("la primera fecha válida desde hoy salta los periodos pasados", () => {
    const today = day("2026-10-12");
    expect(iso(firstOccurrence(day("2026-01-05"), "QUARTERLY", (d) => d >= today))).toBe("2027-01-05");
    expect(iso(firstOccurrence(day("2026-10-12"), "MONTHLY", (d) => d >= today))).toBe("2026-10-12");
  });
});

const fund = (fundId: string, suggested: number, targetPercentage: number, nav: number | null): AllocationCandidate => ({
  fundId,
  suggested,
  targetPercentage,
  nav: nav === null ? null : new Decimal(nav),
});
const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount * 100, 0));

describe("allocateContribution", () => {
  it("reparte según la sugerencia del rebalanceo y suma exactamente la aportación", () => {
    const buys = allocateContribution([fund("a", 66.67, 50, 100), fund("b", 33.33, 50, 30)], new Decimal(100));
    expect(buys.map((b) => [b.fundId, b.amount])).toEqual([["a", 66.67], ["b", 33.33]]);
    expect(buys[0].shares.toString()).toBe("0.6667");
    expect(buys[1].pricePerShare.toString()).toBe("30");
  });

  it("reparte el resto de céntimos sin perder ni sobrar ninguno", () => {
    const buys = allocateContribution([fund("a", 1, 33, 10), fund("b", 1, 33, 10), fund("c", 1, 34, 10)], new Decimal(100));
    expect(sum(buys)).toBe(10000);
    expect(buys.map((b) => b.amount).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it("lo asignado a un fondo que no cotiza va a los demás", () => {
    const buys = allocateContribution([fund("a", 50, 50, 100), fund("sin-ticker", 50, 50, null)], new Decimal(200));
    expect(buys).toHaveLength(1);
    expect(buys[0]).toMatchObject({ fundId: "a", amount: 200 });
  });

  it("si solo el fondo sin cotización tenía déficit, reparte por % objetivo entre los que cotizan", () => {
    const buys = allocateContribution(
      [fund("a", 0, 30, 10), fund("b", 0, 10, 10), fund("sin-ticker", 100, 60, null)],
      new Decimal(100),
    );
    expect(buys.map((b) => [b.fundId, b.amount])).toEqual([["a", 75], ["b", 25]]);
  });

  it("falla si ningún fondo del reparto cotiza", () => {
    expect(() => allocateContribution([fund("x", 100, 100, null)], new Decimal(100))).toThrow(NoTradeableFundsError);
  });
});
