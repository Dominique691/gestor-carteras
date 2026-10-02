import { z } from "zod";

export const rebalanceQuerySchema = z.object({
  newContribution: z
    .string()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, "newContribution debe ser un importe ≥ 0 con hasta 2 decimales")
    .default("0"),
});

export const setTargetsSchema = z.object({
  targets: z
    .array(
      z.object({
        fundId: z.uuid("fundId no válido"),
        targetPercentage: z
          .union([z.number(), z.string()])
          .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(String(v)) && Number(v) > 0 && Number(v) <= 100, {
            message: "targetPercentage debe estar entre 0 (exclusivo) y 100, con hasta 2 decimales",
          }),
      }),
    )
    .max(100)
    .refine((t) => new Set(t.map((x) => x.fundId)).size === t.length, {
      message: "Hay fondos repetidos",
    }),
});
