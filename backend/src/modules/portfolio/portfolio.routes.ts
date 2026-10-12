import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../db.js";
import { Decimal } from "../../lib/decimal.js";
import { validationError } from "../../lib/http.js";
import { buildPortfolio, buildPortfolioHistory } from "../../services/portfolio.service.js";
import { marketData } from "../../services/marketData.service.js";
import { getRebalance, NoTargetsError } from "../../services/rebalance.service.js";
import { rebalanceQuerySchema, setTargetsSchema } from "./portfolio.schemas.js";

const portfolioRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (request) => {
    await marketData.refreshIfStale();
    return buildPortfolio(request.user.sub);
  });

  // Serie temporal de capital invertido vs. valor de mercado, para la gráfica de evolución.
  app.get("/history", async (request) => {
    await marketData.refreshIfStale();
    return buildPortfolioHistory(request.user.sub);
  });

  app.get("/rebalance", async (request, reply) => {
    const parsed = rebalanceQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues));
    await marketData.refreshIfStale();

    try {
      return await getRebalance(request.user.sub, new Decimal(parsed.data.newContribution));
    } catch (err) {
      if (err instanceof NoTargetsError) {
        return reply.code(422).send({
          error: "Define primero tus porcentajes objetivo (POST /api/portfolio/targets)",
        });
      }
      throw err;
    }
  });

  // Reemplaza por completo los objetivos del usuario. Deben sumar 100 % (o ser una lista vacía).
  app.post("/targets", async (request, reply) => {
    const parsed = setTargetsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues));
    const { targets } = parsed.data;
    const userId = request.user.sub;

    const sum = targets.reduce((s, t) => s.plus(new Decimal(String(t.targetPercentage))), new Decimal(0));
    if (targets.length > 0 && !sum.equals(100)) {
      return reply.code(422).send({
        error: "Los porcentajes objetivo deben sumar 100",
        details: [{ field: "targets", message: `Suma actual: ${sum.toString()}` }],
      });
    }

    const found = await prisma.fund.count({ where: { id: { in: targets.map((t) => t.fundId) } } });
    if (found !== targets.length) return reply.code(404).send({ error: "Algún fondo no existe" });

    await prisma.$transaction([
      prisma.targetAllocation.deleteMany({ where: { userId } }),
      prisma.targetAllocation.createMany({
        data: targets.map((t) => ({
          userId,
          fundId: t.fundId,
          targetPercentage: new Decimal(String(t.targetPercentage)),
        })),
      }),
    ]);

    return (await buildPortfolio(userId)).targets;
  });
};

export default portfolioRoutes;
