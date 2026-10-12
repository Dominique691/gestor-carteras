import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  resetPasswordToken: string | null;
  resetPasswordExpires: Date | null;
  isEmailVerified: boolean;
}

const db = vi.hoisted(() => {
  const users = new Map<string, Row>();
  type Where = { id?: string; email?: string; resetPasswordToken?: string };
  return {
    users,
    prisma: {
      user: {
        async findUnique({ where }: { where: Where }) {
          return (
            [...users.values()].find((u) =>
              where.id ? u.id === where.id : where.email ? u.email === where.email : u.resetPasswordToken === where.resetPasswordToken,
            ) ?? null
          );
        },
        async update({ where, data }: { where: { id: string }; data: Partial<Row> }) {
          const row = users.get(where.id)!;
          Object.assign(row, data);
          return row;
        },
      },
    },
  };
});
const sendEmail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../db.js", () => ({ prisma: db.prisma }));
vi.mock("../../services/email.service.js", () => ({ sendResetPasswordEmail: sendEmail }));

import bcrypt from "bcryptjs";
import { buildApp } from "../../app.js";
import { RESET_TOKEN_TTL_MS } from "../../modules/auth/auth.routes.js";

let app: FastifyInstance;
const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const NEW_PASSWORD = "NuevaClave456!";

function seedUser(over: Partial<Row> = {}) {
  const row: Row = {
    id: crypto.randomUUID(),
    email: "ana@example.com",
    passwordHash: bcrypt.hashSync("Antigua123!", 4),
    createdAt: new Date(),
    resetPasswordToken: null,
    resetPasswordExpires: null,
    isEmailVerified: true,
    ...over,
  };
  db.users.set(row.id, row);
  return row;
}

/** Pide un token y lo recupera de la URL enviada por email. */
async function requestToken(email = "ana@example.com") {
  await post("/api/auth/forgot-password", { email });
  const url = sendEmail.mock.calls.at(-1)![1] as string;
  return new URL(url).searchParams.get("token")!;
}

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", "x".repeat(48));
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  db.users.clear();
  sendEmail.mockClear();
});

describe("POST /api/auth/forgot-password", () => {
  it("genera un token con caducidad a 15 minutos y guarda solo su hash", async () => {
    const user = seedUser();
    const before = Date.now();
    const res = await post("/api/auth/forgot-password", { email: user.email });
    const after = Date.now();

    expect(res.statusCode).toBe(200);
    const expires = user.resetPasswordExpires!.getTime();
    expect(RESET_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    expect(expires).toBeGreaterThanOrEqual(before + RESET_TOKEN_TTL_MS);
    expect(expires).toBeLessThanOrEqual(after + RESET_TOKEN_TTL_MS);

    const token = await requestToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(user.resetPasswordToken).toBe(sha256(token));
    expect(user.resetPasswordToken).not.toBe(token);
  });

  it("responde igual (200) para un email inexistente y no envía correo", async () => {
    seedUser();
    const known = await post("/api/auth/forgot-password", { email: "ana@example.com" });
    sendEmail.mockClear();
    const unknown = await post("/api/auth/forgot-password", { email: "nadie@example.com" });

    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toEqual(known.json());
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/reset-password", () => {
  it("cambia la contraseña con un token válido y lo invalida tras usarlo", async () => {
    const user = seedUser();
    const token = await requestToken();

    const ok = await post("/api/auth/reset-password", { token, newPassword: NEW_PASSWORD });
    expect(ok.statusCode).toBe(200);
    expect(await bcrypt.compare(NEW_PASSWORD, user.passwordHash)).toBe(true);
    expect(user.resetPasswordToken).toBeNull();
    expect(user.resetPasswordExpires).toBeNull();

    const reuse = await post("/api/auth/reset-password", { token, newPassword: "OtraClave789!" });
    expect(reuse.statusCode).toBe(400);
  });

  it("verifica la cuenta si estaba pendiente: el enlace llegó a su email", async () => {
    const user = seedUser({ isEmailVerified: false });
    const token = await requestToken();

    await post("/api/auth/reset-password", { token, newPassword: NEW_PASSWORD });
    expect(user.isEmailVerified).toBe(true);
  });

  it("rechaza un token expirado", async () => {
    const user = seedUser();
    const token = await requestToken();
    user.resetPasswordExpires = new Date(Date.now() - 1000);
    const hashBefore = user.passwordHash;

    const res = await post("/api/auth/reset-password", { token, newPassword: NEW_PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(user.passwordHash).toBe(hashBefore);
  });

  it("rechaza un token inválido", async () => {
    const user = seedUser();
    await requestToken();
    const hashBefore = user.passwordHash;

    const res = await post("/api/auth/reset-password", { token: "f".repeat(64), newPassword: NEW_PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(user.passwordHash).toBe(hashBefore);
  });

  it("rechaza una contraseña débil con 400 y no consume el token", async () => {
    const user = seedUser();
    const token = await requestToken();

    const res = await post("/api/auth/reset-password", { token, newPassword: "password" });
    expect(res.statusCode).toBe(400);
    expect(res.json().details[0].field).toBe("newPassword");
    expect(user.resetPasswordToken).toBe(sha256(token));
  });
});
