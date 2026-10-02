import { z } from "zod";
import type { LoginRequestDto, RegisterRequestDto } from "./auth.types.js";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Email no válido").max(254));

export const registerSchema = z.object({
  email,
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .max(72, "La contraseña no puede superar los 72 caracteres")
    .regex(/[A-Za-z]/, "La contraseña debe contener una letra")
    .regex(/\d/, "La contraseña debe contener un número"),
}) satisfies z.ZodType<RegisterRequestDto, unknown>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "La contraseña es obligatoria").max(72),
}) satisfies z.ZodType<LoginRequestDto, unknown>;
