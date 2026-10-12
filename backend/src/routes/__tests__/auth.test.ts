import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Base de datos en memoria que imita lo que usa auth.routes (user.create / findUnique / update).
const db = vi.hoisted(() => {
  interface Row {
    id: string;
    email: string;
    passwordHash: string;
    createdAt: Date;
    isEmailVerified: boolean;
    emailVerificationToken: string | null;
    emailVerificationExpires: Date | null;
  }
  type Where = { id?: string; email?: string; emailVerificationToken?: string };
  const users = new Map<string, Row>();
  return {
    users,
    prisma: {
      user: {
        async create({ data }: { data: Partial<Row> & { email: string; passwordHash: string } }) {
          if ([...users.values()].some((u) => u.email === data.email)) {
            throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          }
          const row: Row = {
            id: crypto.randomUUID(),
            createdAt: new Date(),
            isEmailVerified: false,
            emailVerificationToken: null,
            emailVerificationExpires: null,
            ...data,
          };
          users.set(row.id, row);
          return row;
        },
        async findUnique({ where }: { where: Where }) {
          const match = (u: Row) =>
            where.id
              ? u.id === where.id
              : where.email
                ? u.email === where.email
                : u.emailVerificationToken === where.emailVerificationToken;
          return [...users.values()].find(match) ?? null;
        },
        async update({ where, data }: { where: { id: string }; data: Partial<Row> }) {
          return Object.assign(users.get(where.id)!, data);
        },
      },
    },
  };
});
const sendVerificationEmail = vi.hoisted(() => vi.fn(async (_to: string, _url: string) => {}));
vi.mock("../../db.js", () => ({ prisma: db.prisma }));
vi.mock("../../services/email.service.js", () => ({ sendVerificationEmail, sendResetPasswordEmail: vi.fn() }));

import { createHash } from "node:crypto";
import { buildApp } from "../../app.js";
import { UNVERIFIED_MESSAGE, VERIFY_TOKEN_TTL_MS } from "../../modules/auth/auth.routes.js";

let app: FastifyInstance;

const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });
const credentials = { email: "ana@example.com", password: "Secreta123!" };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const stored = () => [...db.users.values()][0];

/** Token en claro del último enlace de activación enviado. */
const lastVerificationToken = () =>
  new URL(sendVerificationEmail.mock.calls.at(-1)![1]).searchParams.get("token")!;

/** Registra y activa la cuenta, como haría el usuario al abrir el enlace del email. */
async function registerVerified() {
  await post("/api/auth/register", credentials);
  await post("/api/auth/verify-email", { token: lastVerificationToken() });
}

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", "x".repeat(48));
  vi.stubEnv("FRONTEND_URL", "https://app.example.com/");
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  db.users.clear();
  sendVerificationEmail.mockClear();
});

describe("POST /api/auth/register", () => {
  it("crea el usuario sin verificar, no inicia sesión y nunca expone el hash", async () => {
    const res = await post("/api/auth/register", credentials);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({ message: expect.stringContaining("ana@example.com") });
    expect(body).not.toHaveProperty("token");

    expect(stored().isEmailVerified).toBe(false);
    expect(stored().passwordHash).not.toBe(credentials.password);
    expect(stored().passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("envía el enlace de activación y guarda solo el hash del token, con caducidad a 24 h", async () => {
    const before = Date.now();
    await post("/api/auth/register", credentials);

    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    const [to, url] = sendVerificationEmail.mock.calls[0];
    expect(to).toBe("ana@example.com");
    expect(url).toMatch(/^https:\/\/app\.example\.com\/verify-email\?token=[0-9a-f]{64}$/);

    expect(stored().emailVerificationToken).toBe(sha256(lastVerificationToken()));
    const ttl = stored().emailVerificationExpires!.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(VERIFY_TOKEN_TTL_MS - 1000);
    expect(ttl).toBeLessThanOrEqual(VERIFY_TOKEN_TTL_MS + 1000);
  });

  it("rechaza datos no válidos con 400 y detalle por campo", async () => {
    const res = await post("/api/auth/register", { email: "no-es-email", password: "corta" });

    expect(res.statusCode).toBe(400);
    const fields = res.json().details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["email", "password"]));
    expect(db.users.size).toBe(0);
  });

  it("rechaza un email ya registrado (sin distinguir mayúsculas) con 409", async () => {
    await post("/api/auth/register", credentials);
    const res = await post("/api/auth/register", { ...credentials, email: "ANA@Example.com" });

    expect(res.statusCode).toBe(409);
    expect(db.users.size).toBe(1);
  });
});

describe("POST /api/auth/login", () => {
  it("permite entrar con una cuenta verificada y el token da acceso a /me", async () => {
    await registerVerified();
    const res = await post("/api/auth/login", credentials);

    expect(res.statusCode).toBe(200);
    const { token, user } = res.json();
    expect(user.email).toBe("ana@example.com");

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(user.id);
  });

  it("deniega con 403 una cuenta sin verificar", async () => {
    await post("/api/auth/register", credentials);
    const res = await post("/api/auth/login", credentials);

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: UNVERIFIED_MESSAGE });
  });

  it("con contraseña incorrecta responde 401 aunque la cuenta no esté verificada (no revela su estado)", async () => {
    await post("/api/auth/register", credentials);
    const res = await post("/api/auth/login", { ...credentials, password: "OtraClave123!" });

    expect(res.statusCode).toBe(401);
  });

  it("rechaza contraseña incorrecta y usuario inexistente con el mismo 401", async () => {
    await registerVerified();

    const badPassword = await post("/api/auth/login", { ...credentials, password: "OtraClave123!" });
    const unknownUser = await post("/api/auth/login", { email: "nadie@example.com", password: "Secreta123!" });

    expect(badPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(badPassword.json()).toEqual(unknownUser.json());
  });
});

describe("POST /api/auth/verify-email", () => {
  it("activa la cuenta con un token válido y lo invalida tras usarlo", async () => {
    await post("/api/auth/register", credentials);
    const token = lastVerificationToken();

    const res = await post("/api/auth/verify-email", { token });
    expect(res.statusCode).toBe(200);
    expect(stored()).toMatchObject({ isEmailVerified: true, emailVerificationToken: null, emailVerificationExpires: null });

    const again = await post("/api/auth/verify-email", { token });
    expect(again.statusCode).toBe(400);
  });

  it("rechaza un token caducado con 410 y no activa la cuenta", async () => {
    await post("/api/auth/register", credentials);
    stored().emailVerificationExpires = new Date(Date.now() - 1000);

    const res = await post("/api/auth/verify-email", { token: lastVerificationToken() });
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toMatch(/caducado/);
    expect(stored().isEmailVerified).toBe(false);
  });

  it("rechaza un token inexistente con 400 y un cuerpo sin token con detalle por campo", async () => {
    expect((await post("/api/auth/verify-email", { token: "abc" })).statusCode).toBe(400);
    const res = await post("/api/auth/verify-email", {});
    expect(res.statusCode).toBe(400);
    expect(res.json().details[0].field).toBe("token");
  });
});

describe("POST /api/auth/resend-verification", () => {
  it("genera un token nuevo para una cuenta pendiente e invalida el anterior", async () => {
    await post("/api/auth/register", credentials);
    const oldToken = lastVerificationToken();

    const res = await post("/api/auth/resend-verification", { email: "ANA@example.com" });
    expect(res.statusCode).toBe(200);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(2);
    const newToken = lastVerificationToken();
    expect(newToken).not.toBe(oldToken);

    expect((await post("/api/auth/verify-email", { token: oldToken })).statusCode).toBe(400);
    expect((await post("/api/auth/verify-email", { token: newToken })).statusCode).toBe(200);
  });

  it("responde igual para una cuenta ya verificada o inexistente y no envía correo", async () => {
    await registerVerified();
    sendVerificationEmail.mockClear();

    const verified = await post("/api/auth/resend-verification", { email: "ana@example.com" });
    const unknown = await post("/api/auth/resend-verification", { email: "nadie@example.com" });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toEqual(unknown.json());
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });
});

describe("rutas protegidas", () => {
  it("responden 401 sin token o con un token inválido", async () => {
    for (const headers of [{}, { authorization: "Bearer token-falso" }]) {
      const res = await app.inject({ method: "GET", url: "/api/auth/me", headers });
      expect(res.statusCode).toBe(401);
    }
  });
});
