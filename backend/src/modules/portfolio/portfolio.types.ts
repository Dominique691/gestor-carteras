export interface PositionDto {
  fundId: string;
  isin: string;
  name: string;
  category: string;
  shares: number;
  /** Precio medio de compra (coste medio) por participación, en €. */
  averageBuyPrice: number;
  currentNAV: number;
  /** Valor actual de la posición, en €. */
  currentValue: number;
  /** Coste de adquisición de la posición, en €. */
  invested: number;
  pnl: number;
  pnlPercentage: number;
  /** % que representa la posición sobre el patrimonio total. */
  portfolioPercentage: number;
  /** % objetivo definido por el usuario, o null si no hay. */
  targetPercentage: number | null;
}

export interface TargetDto {
  fundId: string;
  isin: string;
  name: string;
  targetPercentage: number;
  /** % actual del fondo en la cartera (0 si no hay posición). */
  currentPercentage: number;
}

export interface PortfolioDto {
  /** Valor de mercado actual de todas las posiciones, en €. */
  totalValue: number;
  /** Coste de adquisición de las posiciones abiertas, en €. */
  totalInvested: number;
  /** P&L latente global: totalValue - totalInvested. */
  pnl: number;
  pnlPercentage: number;
  /** P&L ya realizado por ventas, en €. */
  realizedPnl: number;
  positions: PositionDto[];
  targets: TargetDto[];
}

export interface SetTargetsRequestDto {
  targets: { fundId: string; targetPercentage: number | string }[];
}
