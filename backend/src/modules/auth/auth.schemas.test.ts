import { describe, expect, it } from "vitest";
import { registerSchema } from "./auth.schemas.js";

const parse = (password: string) => registerSchema.safeParse({ email: "ana@example.com", password });
const messages = (password: string) => {
  const r = parse(password);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("registerSchema (contraseña)", () => {
  it.each(["123456", "password", "Password1", "password1!", "Password!!", "Ab1!"])("rechaza %s", (pw) => {
    expect(parse(pw).success).toBe(false);
  });

  it("devuelve mensajes descriptivos", () => {
    expect(messages("123456")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("8 caracteres"),
        expect.stringContaining("mayúscula"),
        expect.stringContaining("carácter especial"),
      ]),
    );
    expect(messages("Password!!")).toEqual([expect.stringContaining("número")]);
  });

  it.each(["Secreta123!", "Password123!", "C0ntraseña#Larga"])("acepta %s", (pw) => {
    expect(parse(pw).success).toBe(true);
  });

  it("limita la longitud en bytes, no en caracteres (límite de bcrypt)", () => {
    const ascii = "A1!" + "a".repeat(69); // 72 caracteres, 72 bytes
    const multibyte = "A1!" + "ñ".repeat(69); // 72 caracteres, 141 bytes
    expect(parse(ascii).success).toBe(true);
    expect(messages(multibyte)).toEqual([expect.stringContaining("72 bytes")]);
  });
});
