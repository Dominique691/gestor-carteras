import { prisma } from "../db.js";
import { Decimal, round } from "../lib/decimal.js";
import { replay } from "../modules/portfolio/portfolio.calc.js";
import type { PortfolioDto, PositionDto, TargetDto } from "../modules/portfolio/portfolio.types.js";

const ZERO = new Decimal(0);
const pct = (part: Decimal, whole: Decimal) => (whole.isZero() ? ZERO : part.div(whole).times(100));

export async function buildPortfolio(userId: string): Promise<PortfolioDto> {
  const [txs, targets] = await Promise.all([
    prisma.transaction.findMany({ where: { userId } }),
    prisma.targetAllocation.findMany({ where: { userId } }),
  ]);
  const holdings = replay(txs);

  const fundIds = new Set([...holdings.keys(), ...targets.map((t) => t.fundId)]);
  const funds = await prisma.fund.findMany({ where: { id: { in: [...fundIds] } } });
  const fundById = new Map(funds.map((f) => [f.id, f]));
  const targetByFund = new Map(targets.map((t) => [t.fundId, t.targetPercentage]));

  const open = [...holdings.entries()].filter(([, h]) => h.shares.gt(0));
  const totalValue = open.reduce((s, [id, h]) => s.plus(h.shares.times(fundById.get(id)!.currentNAV)), ZERO);
  const totalInvested = open.reduce((s, [, h]) => s.plus(h.cost), ZERO);
  const realizedPnl = [...holdings.values()].reduce((s, h) => s.plus(h.realizedPnl), ZERO);
  const pnl = totalValue.minus(totalInvested);

  const positions: PositionDto[] = open
    .map(([id, h]) => {
      const fund = fundById.get(id)!;
      const value = h.shares.times(fund.currentNAV);
      const target = targetByFund.get(id);
      return {
        fundId: id,
        isin: fund.isin,
        name: fund.name,
        category: fund.category,
        shares: round(h.shares, 4),
        averageBuyPrice: round(h.cost.div(h.shares), 4),
        currentNAV: round(fund.currentNAV, 4),
        lastPriceUpdate: fund.lastPriceUpdate?.toISOString() ?? null,
        currentValue: round(value, 2),
        invested: round(h.cost, 2),
        pnl: round(value.minus(h.cost), 2),
        pnlPercentage: round(pct(value.minus(h.cost), h.cost), 2),
        portfolioPercentage: round(pct(value, totalValue), 2),
        targetPercentage: target ? round(target, 2) : null,
      };
    })
    .sort((a, b) => b.currentValue - a.currentValue);

  const currentByFund = new Map(positions.map((p) => [p.fundId, p.portfolioPercentage]));
  const targetDtos: TargetDto[] = targets
    .map((t) => ({
      fundId: t.fundId,
      isin: fundById.get(t.fundId)!.isin,
      name: fundById.get(t.fundId)!.name,
      targetPercentage: round(t.targetPercentage, 2),
      currentPercentage: currentByFund.get(t.fundId) ?? 0,
    }))
    .sort((a, b) => b.targetPercentage - a.targetPercentage);

  return {
    totalValue: round(totalValue, 2),
    totalInvested: round(totalInvested, 2),
    pnl: round(pnl, 2),
    pnlPercentage: round(pct(pnl, totalInvested), 2),
    realizedPnl: round(realizedPnl, 2),
    positions,
    targets: targetDtos,
  };
}
