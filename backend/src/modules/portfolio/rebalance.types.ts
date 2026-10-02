export interface RebalanceItemDto {
  fundId: string;
  isin: string;
  name: string;
  /** % actual sobre el patrimonio actual (sin la aportación). */
  currentPercentage: number;
  targetPercentage: number;
  /** Valor actual de la posición, en €. */
  currentValue: number;
  /** targetTotal × % objetivo, en €. */
  targetValue: number;
  /**
   * Aportación sugerida en €. Parte de max(0, targetValue − currentValue) y se escala para
   * que la suma de todos los fondos sea exactamente la aportación disponible (no se vende
   * nada). Si no hay fondos sobreponderados, es el déficit sin escalar.
   */
  affordableContribution: number;
}

export interface RebalanceDto {
  /** Patrimonio actual, en €. */
  totalValue: number;
  newContribution: number;
  /** Patrimonio actual + aportación, en €. */
  targetTotal: number;
  items: RebalanceItemDto[];
}
