// Requisitos mínimos de contraseña. Deben coincidir con registerSchema del backend.
export const PASSWORD_REQUIREMENTS = [
  { id: "length", label: "Mínimo 8 caracteres", test: (p: string) => p.length >= 8 },
  { id: "upper", label: "Al menos una letra mayúscula", test: (p: string) => /[A-Z]/.test(p) },
  { id: "number", label: "Al menos un número", test: (p: string) => /\d/.test(p) },
  { id: "special", label: "Al menos un carácter especial (!@#$%^&*)", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const;

export const MIN_PASSWORD_SCORE = 2;

export const meetsRequirements = (password: string) => PASSWORD_REQUIREMENTS.every((r) => r.test(password));
