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

export interface CreateTransactionBody {
  fundId: string;
  type: TransactionType;
  shares: number;
  pricePerShare: number;
  transactionDate?: string;
}
