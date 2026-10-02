import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../db.js";
import { round } from "../../lib/decimal.js";
import { marketData } from "../../services/marketData.service.js";
import type { FundDto } from "./funds.types.js";

const fundsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  // Ninguna ruta de este módulo recibe cuerpo. Algunos clientes (PowerShell, Postman…) envían un POST vacío con un
  // Content-Type como application/x-www-form-urlencoded (415) o application/json sin contenido (400). Se sustituyen
  // los parsers, solo dentro de este módulo, por uno que acepta e ignora cualquier cuerpo.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, _body, done) => done(null));

  app.get("/", async (): Promise<FundDto[]> => {
    // Refresca solo los precios caducados; si el proveedor falla, se devuelven los guardados.
    await marketData.refreshIfStale();

    // El catálogo solo ofrece fondos que cotizan (con ticker).
    const funds = await prisma.fund.findMany({
      where: { ticker: { not: null } },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return funds.map((f) => ({
      id: f.id,
      isin: f.isin,
      name: f.name,
      category: f.category,
      currentNAV: round(f.currentNAV, 4),
      ticker: f.ticker,
      lastPriceUpdate: f.lastPriceUpdate?.toISOString() ?? null,
    }));
  });

  // Fuerza la actualización de los precios de todo el catálogo (el catálogo es común a todos los usuarios).
  app.post("/sync-prices", async (_request, reply) => {
    if (!marketData.enabled) {
      return reply.code(503).send({ error: "La sincronización de precios de mercado está desactivada" });
    }
    return marketData.syncPrices({ force: true });
  });
};

export default fundsRoutes;
