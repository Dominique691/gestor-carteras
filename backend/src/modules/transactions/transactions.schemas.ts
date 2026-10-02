import { z } from "zod";
import { decimal12_4 } from "../../lib/decimal.js";

const amount = (field: string) => z.union([z.number(), z.string()]).refine(...decimal12_4(field));

export const createTransactionSchema = z.object({
  fundId: z.uuid("fundId no válido"),
  type: z.enum(["BUY", "SELL"]),
  shares: amount("shares"),
  pricePerShare: amount("pricePerShare"),
  transactionDate: z.iso
    .datetime({ offset: true })
    .optional()
    .refine((d) => !d || new Date(d).getTime() <= Date.now() + 60_000, {
      message: "La fecha no puede ser futura",
    }),
});
