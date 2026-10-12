import { Decimal } from "../../lib/decimal.js";

export type Frequency = "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";

export const MONTHS_BY_FREQUENCY: Record<Frequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

/** Inicio del día (UTC) de una fecha. */
export const startOfDayUTC = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Suma meses conservando el día; si el mes destino es más corto, usa su último día (31 ene + 1 mes = 28/29 feb). */
export function addMonthsUTC(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}

/**
 * Primera fecha del calendario (startDate, startDate + periodo, …) que cumple `accept`.
 * Cada fecha se calcula desde `startDate` y no desde la anterior, para que el día no se desplace:
 * un plan del día 31 cae el 28/29 en febrero y vuelve al 31 en marzo.
 */
export function firstOccurrence(startDate: Date, frequency: Frequency, accept: (d: Date) => boolean): Date {
  const step = MONTHS_BY_FREQUENCY[frequency];
  const start = startOfDayUTC(startDate);
  for (let k = 0; ; k++) {
    const d = addMonthsUTC(start, k * step);
    if (accept(d)) return d;
  }
}

/** Siguiente fecha del calendario estrictamente posterior a `after`. */
export const nextOccurrenceAfter = (startDate: Date, frequency: Frequency, after: Date) =>
  firstOccurrence(startDate, frequency, (d) => d.getTime() > after.getTime());

export interface AllocationCandidate {
  fundId: string;
  /** Aportación que le asigna el rebalanceo, en € (peso del reparto). */
  suggested: number;
  targetPercentage: number;
  /** Precio actual; null si el fondo no cotiza (no se pueden crear compras). */
  nav: Decimal | null;
}

export interface PlannedBuy {
  fundId: string;
  /** Importe en €, con 2 decimales. Las compras suman exactamente la aportación. */
  amount: number;
  shares: Decimal;
  pricePerShare: Decimal;
}

export class NoTradeableFundsError extends Error {
  constructor() {
    super("Ninguno de los fondos del reparto cotiza en bolsa");
  }
}

/**
 * Convierte la aportación en compras. Solo se compran fondos que cotizan: lo que el rebalanceo
 * asigna a un fondo sin cotización se reparte entre los demás en proporción a su sugerencia
 * (o, si ninguno tiene déficit, a su % objetivo). El reparto se hace en céntimos enteros con el
 * método del mayor resto, de modo que la suma es exactamente `amount`.
 */
export function allocateContribution(candidates: AllocationCandidate[], amount: Decimal): PlannedBuy[] {
  const eligible = candidates.filter((c) => c.nav !== null && c.nav.gt(0));
  let weights = eligible.map((c) => Math.max(0, c.suggested));
  if (weights.every((w) => w === 0)) weights = eligible.map((c) => Math.max(0, c.targetPercentage));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) throw new NoTradeableFundsError();

  const budget = amount.times(100).toDecimalPlaces(0).toNumber();
  const exact = weights.map((w) => (w * budget) / totalWeight);
  const cents = exact.map(Math.floor);
  let remainder = budget - cents.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .filter(({ i }) => weights[i] > 0)
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    cents[i] += 1;
    remainder -= 1;
  }

  const buys: PlannedBuy[] = [];
  eligible.forEach((c, i) => {
    if (cents[i] <= 0) return;
    const euros = new Decimal(cents[i]).div(100);
    const shares = euros.div(c.nav!).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    if (shares.lte(0)) return;
    buys.push({ fundId: c.fundId, amount: euros.toNumber(), shares, pricePerShare: c.nav! });
  });
  return buys;
}
