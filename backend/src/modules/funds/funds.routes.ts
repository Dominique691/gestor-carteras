import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../db.js";
import { round } from "../../lib/decimal.js";
import type { FundDto } from "./funds.types.js";

const fundsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (): Promise<FundDto[]> => {
    const funds = await prisma.fund.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
    return funds.map((f) => ({
      id: f.id,
      isin: f.isin,
      name: f.name,
      category: f.category,
      currentNAV: round(f.currentNAV, 4),
    }));
  });
};

export default fundsRoutes;
