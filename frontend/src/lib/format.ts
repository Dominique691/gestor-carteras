const eur = new Intl.NumberFormat("es-ES", { useGrouping: true, style: "currency", currency: "EUR" });
const eurSigned = new Intl.NumberFormat("es-ES", { useGrouping: true, style: "currency", currency: "EUR", signDisplay: "exceptZero" });
const price = new Intl.NumberFormat("es-ES", { useGrouping: true, style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const shares = new Intl.NumberFormat("es-ES", { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 4 });
const percent = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentSigned = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });

/** Número sin símbolo de moneda, de 2 a 4 decimales (para campos con la unidad en la etiqueta). */
export const formatDecimal = (n: number) =>
  n.toLocaleString("es-ES", { useGrouping: true, minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const formatEur =(n: number) => eur.format(n);
export const formatEurSigned = (n: number) => eurSigned.format(n);
/** Precios de participación: 2 a 4 decimales. */
export const formatPrice = (n: number) => price.format(n);
export const formatShares = (n: number) => shares.format(n);
export const formatPercent = (n: number) => `${percent.format(n)} %`;
export const formatPercentSigned = (n: number) => `${percentSigned.format(n)} %`;
