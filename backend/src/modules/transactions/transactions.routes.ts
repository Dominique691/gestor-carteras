import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../db.js";
import { Decimal, round } from "../../lib/decimal.js";
import { validationError } from "../../lib/http.js";
import { catchUpUser } from "../../services/contributions.service.js";
import { InsufficientSharesError, replay } from "../portfolio/portfolio.calc.js";
import { createTransactionSchema } from "./transactions.schemas.js";
import type { TransactionDto } from "./transactions.types.js";

type TxWithFund = {
  id: string;
  fundId: string;
  type: "BUY" | "SELL";
  shares: Decimal;
  pricePerShare: Decimal;
  transactionDate: Date;
  fund: { isin: string; name: string };
};

const toDto = (t: TxWithFund): TransactionDto => ({
  id: t.id,
  fundId: t.fundId,
  isin: t.fund.isin,
  fundName: t.fund.name,
  type: t.type,
  shares: round(t.shares, 4),
  pricePerShare: round(t.pricePerShare, 4),
  total: round(t.shares.times(t.pricePerShare), 2),
  transactionDate: t.transactionDate.toISOString(),
});

class FundNotFoundError extends Error {}
class FundNotTradedError extends Error {}

const transactionsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);
  // Antes de leer la cartera se ejecutan las aportaciones automáticas vencidas (el servidor puede haber estado dormido).
  app.addHook("preHandler", async (request) => {
    await catchUpUser(request.user.sub, (m) => request.log.warn(m));
  });

  app.get("/", async (request): Promise<TransactionDto[]> => {
    const txs = await prisma.transaction.findMany({
      where: { userId: request.user.sub },
      include: { fund: { select: { isin: true, name: true } } },
      orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
    });
    return txs.map(toDto);
  });

  app.post("/", async (request, reply) => {
    const parsed = createTransactionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues));
    const body = parsed.data;
    const userId = request.user.sub;

    try {
      const created = await prisma.$transaction(async (tx) => {
        // Serializa las escrituras del mismo usuario para validar el saldo sin carreras.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;

        const fund = await tx.fund.findUnique({ where: { id: body.fundId } });
        if (!fund) throw new FundNotFoundError();
        // Solo se puede comprar en fondos que cotizan; vender uno heredado sin ticker sigue permitido.
        if (!fund.ticker && body.type === "BUY") throw new FundNotTradedError();

        const created = await tx.transaction.create({
          data: {
            userId,
            fundId: body.fundId,
            type: body.type,
            shares: new Decimal(String(body.shares)),
            pricePerShare: new Decimal(String(body.pricePerShare)),
            transactionDate: body.transactionDate ? new Date(body.transactionDate) : new Date(),
          },
          include: { fund: { select: { isin: true, name: true } } },
        });

        // Una venta (o una operación con fecha pasada) puede dejar el historial incoherente.
        if (body.type === "SELL" || body.transactionDate) {
          const history = await tx.transaction.findMany({ where: { userId, fundId: body.fundId } });
          replay(history); // lanza InsufficientSharesError -> rollback
        }
        return created;
      });
      return reply.code(201).send(toDto(created));
    } catch (err) {
      if (err instanceof FundNotFoundError) return reply.code(404).send({ error: "Fondo no encontrado" });
      if (err instanceof FundNotTradedError) {
        return reply.code(422).send({ error: "Este fondo no cotiza en bolsa y no está disponible para nuevas compras" });
      }
      if (err instanceof InsufficientSharesError) {
        return reply.code(422).send({
          error: "No tienes participaciones suficientes para esta venta",
          details: [
            {
              field: "shares",
              message: `Disponibles a ${err.date.toISOString()}: ${round(err.available, 4)}; solicitadas: ${round(err.requested, 4)}`,
            },
          ],
        });
      }
      throw err;
    }
  });
};

export default transactionsRoutes;
