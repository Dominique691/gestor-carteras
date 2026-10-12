import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../db.js";
import { Decimal, round } from "../../lib/decimal.js";
import { validationError } from "../../lib/http.js";
import { catchUpUser, runAllDue } from "../../services/contributions.service.js";
import { firstOccurrence, startOfDayUTC, type Frequency } from "./contributions.calc.js";
import { setContributionPlanSchema } from "./contributions.schemas.js";
import type { ContributionsDto } from "./contributions.types.js";

const RUNS_SHOWN = 12;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function getContributions(userId: string): Promise<ContributionsDto> {
  const [plan, runs] = await Promise.all([
    prisma.contributionPlan.findUnique({ where: { userId } }),
    prisma.contributionRun.findMany({ where: { userId }, orderBy: { scheduledFor: "desc" }, take: RUNS_SHOWN }),
  ]);
  return {
    plan: plan && {
      amount: round(plan.amount, 2),
      frequency: plan.frequency,
      startDate: isoDay(plan.startDate),
      active: plan.active,
      nextRunAt: plan.active ? isoDay(plan.nextRunAt) : null,
    },
    runs: runs.map((r) => ({
      id: r.id,
      scheduledFor: isoDay(r.scheduledFor),
      executedAt: r.executedAt.toISOString(),
      amount: round(r.amount, 2),
      status: r.status,
      purchases: r.purchases,
      message: r.message,
    })),
  };
}

/** Aportación periódica automática del usuario (una por usuario). */
const contributionsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (request) => {
    await catchUpUser(request.user.sub, (m) => request.log.warn(m));
    return getContributions(request.user.sub);
  });

  // Crea o sustituye el plan. La próxima ejecución es la primera fecha del calendario desde hoy que aún no se haya
  // ejecutado: guardar o reanudar un plan nunca pone al día periodos pasados.
  app.put("/", async (request, reply) => {
    const parsed = setContributionPlanSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error.issues));
    const { amount, frequency, startDate, active = true } = parsed.data;
    const userId = request.user.sub;

    if (active && (await prisma.targetAllocation.count({ where: { userId } })) === 0) {
      return reply.code(422).send({ error: "Guarda primero tus porcentajes objetivo: la aportación se reparte con ellos" });
    }

    const start = new Date(`${startDate}T00:00:00.000Z`);
    const today = startOfDayUTC(new Date());
    const done = new Set(
      (await prisma.contributionRun.findMany({ where: { userId, scheduledFor: { gte: today } }, select: { scheduledFor: true } }))
        .map((r) => r.scheduledFor.getTime()),
    );
    const nextRunAt = firstOccurrence(start, frequency as Frequency, (d) => d >= today && !done.has(d.getTime()));

    const data = { amount: new Decimal(String(amount)), frequency, startDate: start, active, nextRunAt };
    await prisma.contributionPlan.upsert({ where: { userId }, create: { userId, ...data }, update: data });

    // Si la primera fecha es hoy, se ejecuta ya.
    await catchUpUser(userId, (m) => request.log.warn(m));
    return getContributions(userId);
  });

  app.delete("/", async (request, reply) => {
    await prisma.contributionPlan.deleteMany({ where: { userId: request.user.sub } });
    return reply.code(204).send();
  });
};

/**
 * Disparador para un cron externo (p. ej. cron-job.org o GitHub Actions): despierta el servidor y ejecuta las
 * aportaciones vencidas de todos los usuarios. Solo existe si se define CRON_SECRET, y exige
 * `Authorization: Bearer <CRON_SECRET>`.
 */
export const contributionsCronRoutes: FastifyPluginAsync = async (app) => {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return;
  const expected = Buffer.from(`Bearer ${secret}`);

  // El cuerpo no se usa. Los servicios de cron envían cualquier Content-Type (cron-job.org usa
  // application/x-www-form-urlencoded, que Fastify rechazaría con 415): se acepta y se ignora.
  // Solo afecta a este plugin, que está encapsulado.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_request, payload, done) => {
    payload.resume();
    done(null, undefined);
  });

  app.post("/run-due", async (request, reply) => {
    const given = Buffer.from(request.headers.authorization ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return reply.code(401).send({ error: "No autorizado" });
    }
    return runAllDue(new Date(), (m) => request.log.info(m));
  });
};

export default contributionsRoutes;
