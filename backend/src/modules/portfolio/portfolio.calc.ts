import { Decimal } from "../../lib/decimal.js";

export interface TxInput {
  id: string;
  fundId: string;
  type: "BUY" | "SELL";
  shares: Decimal;
  pricePerShare: Decimal;
  transactionDate: Date;
}

export interface Holding {
  shares: Decimal;
  /** Coste de adquisición de las participaciones que se mantienen (método de coste medio). */
  cost: Decimal;
  /** P&L ya realizado por ventas. */
  realizedPnl: Decimal;
}

export class InsufficientSharesError extends Error {
  constructor(
    public fundId: string,
    public available: Decimal,
    public requested: Decimal,
    public date: Date,
  ) {
    super("Participaciones insuficientes");
  }
}

/**
 * Reproduce el historial en orden cronológico (a igual fecha, compras antes que ventas)
 * y devuelve la posición por fondo con coste medio. Lanza si alguna venta excede lo que
 * se poseía en ese momento.
 */
export function replay(txs: TxInput[]): Map<string, Holding> {
  const ordered = [...txs].sort(
    (a, b) =>
      a.transactionDate.getTime() - b.transactionDate.getTime() ||
      (a.type === b.type ? 0 : a.type === "BUY" ? -1 : 1) ||
      a.id.localeCompare(b.id),
  );

  const holdings = new Map<string, Holding>();
  for (const tx of ordered) {
    const h = holdings.get(tx.fundId) ?? {
      shares: new Decimal(0),
      cost: new Decimal(0),
      realizedPnl: new Decimal(0),
    };

    if (tx.type === "BUY") {
      h.shares = h.shares.plus(tx.shares);
      h.cost = h.cost.plus(tx.shares.times(tx.pricePerShare));
    } else {
      if (tx.shares.gt(h.shares)) {
        throw new InsufficientSharesError(tx.fundId, h.shares, tx.shares, tx.transactionDate);
      }
      const costRemoved = h.shares.isZero() ? new Decimal(0) : h.cost.times(tx.shares).div(h.shares);
      h.realizedPnl = h.realizedPnl.plus(tx.shares.times(tx.pricePerShare).minus(costRemoved));
      h.shares = h.shares.minus(tx.shares);
      h.cost = h.shares.isZero() ? new Decimal(0) : h.cost.minus(costRemoved);
    }
    holdings.set(tx.fundId, h);
  }
  return holdings;
}
