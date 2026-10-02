export interface FundDto {
  id: string;
  isin: string;
  name: string;
  category: string;
  currentNAV: number;
  /** Símbolo de cotización en Yahoo Finance, o null si el fondo no cotiza en bolsa. */
  ticker: string | null;
  /** Última actualización del NAV con datos de mercado (ISO 8601), o null si nunca se ha sincronizado. */
  lastPriceUpdate: string | null;
}
