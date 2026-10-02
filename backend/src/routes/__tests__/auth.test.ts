import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Base de datos en memoria que imita lo que usa auth.routes (user.create / user.findUnique).
const db = vi.hoisted(() => {
  interface Row {
    id: string;
    email: string;
    passwordHash: string;
    createdAt: Date;
  }
  const users = new Map<string, Row>();
  return {
    users,
    prisma: {
      user: {
        async create({ data }: { data: { email: string; passwordHash: string } }) {
          if ([...users.values()].some((u) => u.email === data.email)) {
            throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          }
          const row: Row = { id: crypto.randomUUID(), createdAt: new Date(), ...data };
          users.set(row.id, row);
          return row;
        },
        async findUnique({ where }: { where: { id?: string; email?: string } }) {
          const match = (u: Row) => (where.id ? u.id === where.id : u.email === where.email);
          return [...users.values()].find(match) ?? null;
        },
      },
    },
  };
});
vi.mock("../../db.js", () => ({ prisma: db.prisma }));

import { buildApp } from "../../app.js";

let app: FastifyInstance;

const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });
const credentials = { email: "ana@example.com", password: "Secreta123" };

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", "x".repeat(48));
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

beforeEach(() => db.users.clear());

describe("POST /api/auth/register", () => {
  it("crea el usuario, devuelve token y nunca expone el hash", async () => {
    const res = await post("/api/auth/register", credentials);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.user).toMatchObject({ email: "ana@example.com" });
    expect(body.user).not.toHaveProperty("passwordHash");

    const stored = [...db.users.values()][0];
    expect(stored.passwordHash).not.toBe(credentials.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
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
  it("permite entrar con las credenciales registradas y el token da acceso a /me", async () => {
    await post("/api/auth/register", credentials);
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

  it("rechaza contraseña incorrecta y usuario inexistente con el mismo 401", async () => {
    await post("/api/auth/register", credentials);

    const badPassword = await post("/api/auth/login", { ...credentials, password: "OtraClave123" });
    const unknownUser = await post("/api/auth/login", { email: "nadie@example.com", password: "Secreta123" });

    expect(badPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(badPassword.json()).toEqual(unknownUser.json());
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
