import { Prisma } from "../generated/prisma/client.js";

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

/** Redondea a `dp` decimales (half-up) y devuelve un number apto para JSON. */
export const round = (d: Decimal, dp: number): number =>
  d.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toNumber();

/** Cantidad positiva con hasta 8 enteros y 4 decimales (encaja en Decimal(12,4)). */
export const decimal12_4 = (field: string) =>
  [
    (v: number | string) => /^\d{1,8}(\.\d{1,4})?$/.test(String(v)) && Number(v) > 0,
    { message: `${field} debe ser > 0, con hasta 8 enteros y 4 decimales` },
  ] as const;
