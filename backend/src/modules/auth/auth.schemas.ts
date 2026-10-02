import { z } from "zod";
import type {
  ForgotPasswordRequestDto,
  LoginRequestDto,
  RegisterRequestDto,
  ResetPasswordRequestDto,
} from "./auth.types.js";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Email no válido").max(254));

/** Reglas de complejidad compartidas por registro y restablecimiento. */
const strongPassword = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(72, "La contraseña no puede superar los 72 caracteres")
  .regex(/[A-Z]/, "La contraseña debe contener al menos una letra mayúscula")
  .regex(/\d/, "La contraseña debe contener al menos un número")
  .regex(/[^A-Za-z0-9]/, "La contraseña debe contener al menos un carácter especial (!@#$%^&*)");

export const registerSchema = z.object({
  email,
  password: strongPassword,
}) satisfies z.ZodType<RegisterRequestDto, unknown>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "La contraseña es obligatoria").max(72),
}) satisfies z.ZodType<LoginRequestDto, unknown>;

export const forgotPasswordSchema = z.object({ email }) satisfies z.ZodType<ForgotPasswordRequestDto, unknown>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "El token es obligatorio").max(256),
  newPassword: strongPassword,
}) satisfies z.ZodType<ResetPasswordRequestDto, unknown>;
