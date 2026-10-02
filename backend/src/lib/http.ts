import type { ErrorResponseDto } from "../modules/auth/auth.types.js";

export function validationError(
  issues: { path: PropertyKey[]; message: string }[],
): ErrorResponseDto {
  return {
    error: "Datos no válidos",
    details: issues.map((i) => ({ field: i.path.join("."), message: i.message })),
  };
}
