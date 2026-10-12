import { Decimal, round } from "../../lib/decimal.js";
import { applyTx, sortTxs, type Holding, type TxInput } from "./portfolio.calc.js";
import type { PortfolioHistoryPointDto } from "./portfolio.types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Por encima de este número de días la serie pasa a ser semanal (se conservan los días con operaciones). */
const MAX_DAILY_POINTS = 400;

const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Precio conocido de un fondo en un día concreto (inicio del día UTC, en ms). */
interface PricePoint {
  day: number;
  price: Decimal;
}

/**
 * Precio estimado en `day`: interpolación lineal entre los precios conocidos más cercanos.
 * Antes del primero o después del último se mantiene el extremo.
 */
export function priceAt(points: PricePoint[], day: number): Decimal {
  if (day <= points[0].day) return points[0].price;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (day <= b.day) {
      const a = points[i - 1];
      const t = new Decimal(day - a.day).div(b.day - a.day);
      return a.price.plus(b.price.minus(a.price).times(t));
    }
  }
  return points[points.length - 1].price;
}

/**
 * Evolución diaria (semanal en historiales largos) del capital invertido y del valor de mercado.
 *
 * No se guarda un histórico de NAVs, así que el precio de cada fondo en cada día se estima interpolando
 * entre los precios conocidos: el de cada operación y el NAV actual (en `today`). El último punto coincide
 * con el patrimonio y la inversión del dashboard.
 *
 * `invested` es el coste de adquisición de las posiciones abiertas (coste medio), igual que `totalInvested`.
 * La serie arranca el día anterior a la primera operación (con 0 €) para que la gráfica no empiece cortada.
 */
export function buildHistory(
  txs: TxInput[],
  currentNavByFund: Map<string, Decimal>,
  today: Date,
): PortfolioHistoryPointDto[] {
  if (txs.length === 0) return [];
  const ordered = sortTxs(txs);

  // Precios conocidos por fondo (si hay varias operaciones el mismo día, prevalece la última).
  const pricesByFund = new Map<string, Map<number, Decimal>>();
  for (const tx of ordered) {
    const prices = pricesByFund.get(tx.fundId) ?? new Map<number, Decimal>();
    prices.set(dayStart(tx.transactionDate), tx.pricePerShare);
    pricesByFund.set(tx.fundId, prices);
  }
  const lastTxDay = dayStart(ordered[ordered.length - 1].transactionDate);
  const end = Math.max(dayStart(today), lastTxDay);
  const curves = new Map<string, PricePoint[]>();
  for (const [fundId, prices] of pricesByFund) {
    const nav = currentNavByFund.get(fundId);
    if (nav) prices.set(end, nav);
    curves.set(
      fundId,
      [...prices.entries()].map(([day, price]) => ({ day, price })).sort((a, b) => a.day - b.day),
    );
  }

  const start = dayStart(ordered[0].transactionDate) - DAY_MS;
  const totalDays = Math.round((end - start) / DAY_MS);
  const step = totalDays > MAX_DAILY_POINTS ? 7 : 1;
  const txDays = new Set(ordered.map((tx) => dayStart(tx.transactionDate)));

  const holdings = new Map<string, Holding>();
  const points: PortfolioHistoryPointDto[] = [];
  let next = 0;
  for (let i = 0; i <= totalDays; i++) {
    const day = start + i * DAY_MS;
    while (next < ordered.length && dayStart(ordered[next].transactionDate) <= day) {
      applyTx(holdings, ordered[next++]);
    }
    if (i % step !== 0 && !txDays.has(day) && day !== end) continue;

    let invested = new Decimal(0);
    let value = new Decimal(0);
    for (const [fundId, h] of holdings) {
      if (h.shares.lte(0)) continue;
      invested = invested.plus(h.cost);
      value = value.plus(h.shares.times(priceAt(curves.get(fundId)!, day)));
    }
    points.push({ date: isoDay(day), invested: round(invested, 2), currentValue: round(value, 2) });
  }
  return points;
}
