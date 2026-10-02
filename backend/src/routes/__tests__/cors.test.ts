import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db.js", () => ({ prisma: {} }));

import { buildApp } from "../../app.js";

afterEach(() => vi.unstubAllEnvs());

async function preflight(origin: string) {
  vi.stubEnv("JWT_SECRET", "x".repeat(48));
  const app = await buildApp({ logger: false });
  const res = await app.inject({
    method: "OPTIONS",
    url: "/api/auth/login",
    headers: { origin, "access-control-request-method": "POST" },
  });
  await app.close();
  return res.headers["access-control-allow-origin"];
}

describe("CORS", () => {
  it("con FRONTEND_URL solo permite ese origen (ignorando la barra final)", async () => {
    vi.stubEnv("FRONTEND_URL", "https://app.vercel.app/");
    expect(await preflight("https://app.vercel.app")).toBe("https://app.vercel.app");
    // El navegador bloquea la respuesta: la cabecera nunca refleja un origen ajeno.
    expect(await preflight("https://otro.com")).not.toBe("https://otro.com");
  });

  it("sin FRONTEND_URL permite cualquier origen", async () => {
    vi.stubEnv("FRONTEND_URL", "");
    expect(await preflight("https://cualquiera.com")).toBe("*");
  });
});
