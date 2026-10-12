import { z } from "zod";
import type { SetContributionPlanRequestDto } from "./contributions.types.js";

export const setContributionPlanSchema = z.object({
  amount: z
    .union([z.number(), z.string()])
    .refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(String(v)) && Number(v) >= 1, {
      message: "El importe debe ser de al menos 1 €, con hasta 2 decimales",
    }),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL"], { message: "Frecuencia no válida" }),
  startDate: z.iso.date("Fecha no válida (YYYY-MM-DD)"),
  active: z.boolean().optional(),
}) satisfies z.ZodType<SetContributionPlanRequestDto, unknown>;
