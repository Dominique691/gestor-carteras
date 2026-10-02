/** Tipos de las respuestas del backend usadas por el dashboard. */

export interface Fund {
  id: string;
  isin: string;
  name: string;
  category: string;
  currentNAV: number;
}

export interface Position {
  fundId: string;
  isin: string;
  name: string;
  category: string;
  shares: number;
  averageBuyPrice: number;
  currentNAV: number;
  currentValue: number;
  invested: number;
  pnl: number;
  pnlPercentage: number;
  portfolioPercentage: number;
  targetPercentage: number | null;
}

export interface Target {
  fundId: string;
  isin: string;
  name: string;
  targetPercentage: number;
  currentPercentage: number;
}

export interface Portfolio {
  totalValue: number;
  totalInvested: number;
  pnl: number;
  pnlPercentage: number;
  realizedPnl: number;
  positions: Position[];
  targets: Target[];
}

export type TransactionType = "BUY" | "SELL";

/** Operación del historial (GET /api/transactions), de la más reciente a la más antigua. */
export interface TransactionItem {
  id: string;
  fundId: string;
  isin: string;
  fundName: string;
  type: TransactionType;
  shares: number;
  pricePerShare: number;
  /** shares × pricePerShare, en €. */
  total: number;
  transactionDate: string;
}

export interface CreateTransactionBody {
  fundId: string;
  type: TransactionType;
  shares: number;
  pricePerShare: number;
  transactionDate?: string;
}
