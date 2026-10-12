/** Tipos de las respuestas del backend usadas por el dashboard. */

export interface Fund {
  id: string;
  isin: string;
  name: string;
  category: string;
  currentNAV: number;
  /** Símbolo en Yahoo Finance, o null si el fondo no cotiza en bolsa (NAV fijo). */
  ticker: string | null;
  /** Última actualización del precio con datos de mercado (ISO 8601), o null si nunca. */
  lastPriceUpdate: string | null;
}

/** Respuesta de POST /api/funds/sync-prices. */
export interface SyncSummary {
  total: number;
  updated: number;
  failed: number;
  skipped: number;
  syncedAt: string;
  results: {
    fundId: string;
    isin: string;
    ticker: string | null;
    status: "updated" | "failed" | "skipped";
    price?: number;
    reason?: string;
    detail?: string;
  }[];
}

export interface Position {
  fundId: string;
  isin: string;
  name: string;
  category: string;
  shares: number;
  averageBuyPrice: number;
  currentNAV: number;
  /** Última actualización del precio con datos de mercado (ISO 8601), o null si nunca. */
  lastPriceUpdate: string | null;
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

/** Punto de GET /api/portfolio/history, en orden cronológico. */
export interface PortfolioHistoryPoint {
  /** Día (YYYY-MM-DD, UTC). */
  date: string;
  /** Capital invertido en las posiciones abiertas, en €. */
  invested: number;
  /** Valor de mercado estimado ese día, en €. */
  currentValue: number;
}
