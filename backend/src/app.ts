import cors from "@fastify/cors";
import Fastify from "fastify";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./modules/auth/auth.routes.js";
import fundsRoutes from "./modules/funds/funds.routes.js";
import portfolioRoutes from "./modules/portfolio/portfolio.routes.js";
import transactionsRoutes from "./modules/transactions/transactions.routes.js";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });

  // Con FRONTEND_URL solo se acepta ese origen; sin ella (desarrollo/demo) se permite cualquiera.
  const frontendUrl = process.env.FRONTEND_URL?.trim().replace(/\/+$/, "");
  await app.register(cors, { origin: frontendUrl || "*" });

  await app.register(authPlugin);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(fundsRoutes, { prefix: "/api/funds" });
  await app.register(transactionsRoutes, { prefix: "/api/transactions" });
  await app.register(portfolioRoutes, { prefix: "/api/portfolio" });

  app.get("/api/health", async () => ({ status: "ok" }));

  return app;
}
