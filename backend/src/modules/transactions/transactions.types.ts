export type TransactionType = "BUY" | "SELL";

export interface CreateTransactionRequestDto {
  fundId: string;
  type: TransactionType;
  shares: number | string;
  pricePerShare: number | string;
  /** ISO 8601. Si se omite, se usa el momento actual. */
  transactionDate?: string;
}

export interface TransactionDto {
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
