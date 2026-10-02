/**
 * Cálculo de rebalanceo por aportación (sin vender), en el cliente para que la tabla responda
 * al instante a objetivos todavía sin guardar. Misma fórmula que GET /api/portfolio/rebalance:
 *   targetTotal = patrimonio + aportación · targetValue = targetTotal × %objetivo
 *   déficit = max(0, targetValue − valorActual), repartido para sumar exactamente la aportación.
 */

export interface RebalanceFund {
  fundId: string;
  currentValue: number;
  /** % objetivo (0-100). */
  targetPercentage: number;
}

export interface RebalanceRow extends RebalanceFund {
  currentPercentage: number;
  targetValue: number;
  /** Aportación sugerida en €. La suma de todas las filas es exactamente la aportación. */
  contribution: number;
}

export interface RebalanceResult {
  totalValue: number;
  targetTotal: number;
  rows: RebalanceRow[];
}

const toCents = (euros: number) => Math.round(euros * 100);

export function computeRebalance(funds: RebalanceFund[], newContribution: number): RebalanceResult {
  const totalValue = funds.reduce((s, f) => s + f.currentValue, 0);
  const targetTotal = totalValue + newContribution;
  const budget = toCents(newContribution);

  const targetValues = funds.map((f) => (targetTotal * f.targetPercentage) / 100);
  const deficits = funds.map((f, i) => Math.max(0, toCents(targetValues[i]) - toCents(f.currentValue)));
  const totalDeficit = deficits.reduce((a, b) => a + b, 0);

  // Reparto proporcional al déficit en céntimos enteros; el resto va a los mayores restos.
  const shares = deficits.map((d) => (totalDeficit > 0 ? (d * budget) / totalDeficit : 0));
  const cents = shares.map(Math.floor);
  let remainder = totalDeficit > 0 ? budget - cents.reduce((a, b) => a + b, 0) : 0;
  const byRemainder = shares
    .map((s, i) => ({ i, frac: s - Math.floor(s), eligible: deficits[i] > 0 }))
    .filter((x) => x.eligible)
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of byRemainder) {
    if (remainder <= 0) break;
    cents[i] += 1;
    remainder -= 1;
  }

  const rows = funds
    .map((f, i) => ({
      ...f,
      currentPercentage: totalValue > 0 ? (f.currentValue / totalValue) * 100 : 0,
      targetValue: Math.round(targetValues[i] * 100) / 100,
      contribution: cents[i] / 100,
    }))
    .sort((a, b) => b.contribution - a.contribution || b.targetPercentage - a.targetPercentage);

  return { totalValue, targetTotal, rows };
}

export interface PlannedPurchase {
  fundId: string;
  /** Importe pedido en €. */
  amount: number;
  /** Participaciones a comprar (importe ÷ precio, 4 decimales). */
  shares: number;
  pricePerShare: number;
}

/** Convierte las aportaciones sugeridas en compras concretas al NAV actual de cada fondo. */
export function planPurchases(rows: RebalanceRow[], navByFund: Map<string, number>): PlannedPurchase[] {
  const plan: PlannedPurchase[] = [];
  for (const r of rows) {
    const nav = navByFund.get(r.fundId);
    if (!nav || r.contribution <= 0) continue;
    const shares = Math.round((r.contribution / nav) * 1e4) / 1e4;
    if (shares > 0) plan.push({ fundId: r.fundId, amount: r.contribution, shares, pricePerShare: nav });
  }
  return plan;
}

/** Parseo de importes/porcentajes escritos por el usuario (admite coma o punto). */
export function parseDecimal(input: string, maxDecimals: number): number | null {
  const s = input.trim();
  if (!new RegExp(`^\\d+([.,]\\d{1,${maxDecimals}})?$`).test(s)) return null;
  return Number(s.replace(",", "."));
}
