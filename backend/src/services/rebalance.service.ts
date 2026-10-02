import { Decimal, round } from "../lib/decimal.js";
import type { RebalanceDto, RebalanceItemDto } from "../modules/portfolio/rebalance.types.js";
import { buildPortfolio } from "./portfolio.service.js";

export class NoTargetsError extends Error {
  constructor() {
    super("El usuario no tiene objetivos definidos");
  }
}

interface FundState {
  fundId: string;
  isin: string;
  name: string;
  currentValue: Decimal;
  targetPercentage: Decimal;
}

const ZERO = new Decimal(0);

/**
 * Lógica pura de rebalanceo mediante aportaciones (sin vender):
 *   targetTotal    = patrimonio actual + aportación
 *   targetValue    = targetTotal × % objetivo
 *   suggested      = max(0, targetValue − valor actual)
 *
 * Si hay fondos sobreponderados, la suma de `suggested` supera la aportación (esos fondos
 * no se venden). `affordableContribution` reparte la aportación real entre los fondos
 * infraponderados en proporción a su déficit, de modo que suma exactamente la aportación
 * (salvo redondeo de céntimos).
 */
export function computeRebalance(funds: FundState[], newContribution: Decimal): RebalanceDto {
  const totalValue = funds.reduce((s, f) => s.plus(f.currentValue), ZERO);
  const targetTotal = totalValue.plus(newContribution);

  const rows = funds.map((f) => {
    const targetValue = targetTotal.times(f.targetPercentage).div(100);
    return { f, targetValue, suggested: Decimal.max(0, targetValue.minus(f.currentValue)) };
  });
  const totalSuggested = rows.reduce((s, r) => s.plus(r.suggested), ZERO);

  const items: RebalanceItemDto[] = rows
    .map(({ f, targetValue, suggested }) => ({
      fundId: f.fundId,
      isin: f.isin,
      name: f.name,
      currentPercentage: round(totalValue.isZero() ? ZERO : f.currentValue.div(totalValue).times(100), 2),
      targetPercentage: round(f.targetPercentage, 2),
      currentValue: round(f.currentValue, 2),
      targetValue: round(targetValue, 2),
      affordableContribution: round(
        totalSuggested.isZero() ? ZERO : suggested.times(newContribution).div(totalSuggested),
        2,
      ),
    }))
    .sort((a, b) => b.affordableContribution - a.affordableContribution || b.targetPercentage - a.targetPercentage);

  return {
    totalValue: round(totalValue, 2),
    newContribution: round(newContribution, 2),
    targetTotal: round(targetTotal, 2),
    items,
  };
}

export async function getRebalance(userId: string, newContribution: Decimal): Promise<RebalanceDto> {
  const portfolio = await buildPortfolio(userId);
  if (portfolio.targets.length === 0) throw new NoTargetsError();

  const byFund = new Map<string, FundState>();
  for (const p of portfolio.positions) {
    byFund.set(p.fundId, {
      fundId: p.fundId,
      isin: p.isin,
      name: p.name,
      currentValue: new Decimal(p.currentValue),
      targetPercentage: new Decimal(p.targetPercentage ?? 0), // posición sin objetivo => 0 %
    });
  }
  for (const t of portfolio.targets) {
    const existing = byFund.get(t.fundId);
    if (existing) continue; // ya cargado con su objetivo
    byFund.set(t.fundId, {
      fundId: t.fundId,
      isin: t.isin,
      name: t.name,
      currentValue: ZERO,
      targetPercentage: new Decimal(t.targetPercentage),
    });
  }

  return computeRebalance([...byFund.values()], newContribution);
}
