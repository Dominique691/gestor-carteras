import { prisma } from "../db.js";
import {
  allocateContribution,
  nextOccurrenceAfter,
  NoTradeableFundsError,
  type Frequency,
} from "../modules/contributions/contributions.calc.js";
import { marketData } from "./marketData.service.js";
import { getRebalance, NoTargetsError } from "./rebalance.service.js";

/** Tope de aportaciones atrasadas que se ponen al día en una sola pasada por usuario. */
const MAX_CATCH_UP = 24;

export interface RunSummary {
  executed: number;
  failed: number;
}

/**
 * Ejecuta la aportación pendiente más antigua de un usuario, si la hay. Devuelve su estado o null si no había nada.
 *
 * Todo ocurre en una transacción con la fila del usuario bloqueada (igual que POST /api/transactions), así que dos
 * disparadores simultáneos (temporizador, petición del usuario, cron externo) no pueden duplicar una aportación;
 * además, `ContributionRun` es única por (usuario, fecha programada).
 *
 * Las compras se registran al precio actual de cada fondo y con la fecha real de ejecución: si una aportación se
 * ejecuta con retraso (el servidor estaba dormido), no se inventa un precio del pasado.
 */
async function runNextForUser(userId: string, now: Date): Promise<"SUCCESS" | "FAILED" | null> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      const plan = await tx.contributionPlan.findUnique({ where: { userId } });
      if (!plan || !plan.active || plan.nextRunAt > now) return null;

      const scheduledFor = plan.nextRunAt;
      let status: "SUCCESS" | "FAILED" = "SUCCESS";
      let message: string | null = null;
      let purchases = 0;

      try {
        const rebalance = await getRebalance(userId, plan.amount);
        const funds = await tx.fund.findMany({ where: { id: { in: rebalance.items.map((i) => i.fundId) } } });
        const fundById = new Map(funds.map((f) => [f.id, f]));
        const buys = allocateContribution(
          rebalance.items.map((i) => {
            const fund = fundById.get(i.fundId);
            return {
              fundId: i.fundId,
              suggested: i.affordableContribution,
              targetPercentage: i.targetPercentage,
              nav: fund?.ticker ? fund.currentNAV : null, // solo se compran fondos que cotizan
            };
          }),
          plan.amount,
        );
        for (const b of buys) {
          await tx.transaction.create({
            data: {
              userId,
              fundId: b.fundId,
              type: "BUY",
              shares: b.shares,
              pricePerShare: b.pricePerShare,
              transactionDate: now,
            },
          });
        }
        purchases = buys.length;
        if (purchases === 0) {
          status = "FAILED";
          message = "El importe es demasiado pequeño para comprar participaciones";
        }
      } catch (err) {
        if (err instanceof NoTargetsError) {
          status = "FAILED";
          message = "No hay porcentajes objetivo guardados";
        } else if (err instanceof NoTradeableFundsError) {
          status = "FAILED";
          message = err.message;
        } else {
          throw err;
        }
      }

      await tx.contributionRun.create({
        data: { userId, scheduledFor, executedAt: now, amount: plan.amount, status, purchases, message },
      });
      // Una aportación fallida no se reintenta: se registra y el plan pasa a la siguiente fecha.
      await tx.contributionPlan.update({
        where: { userId },
        data: { nextRunAt: nextOccurrenceAfter(plan.startDate, plan.frequency as Frequency, scheduledFor) },
      });
      return status;
    },
    { timeout: 20_000 },
  );
}

/** Pone al día las aportaciones vencidas de un usuario. */
export async function runDueForUser(userId: string, now = new Date()): Promise<RunSummary> {
  const summary: RunSummary = { executed: 0, failed: 0 };
  for (let i = 0; i < MAX_CATCH_UP; i++) {
    const status = await runNextForUser(userId, now);
    if (!status) break;
    if (status === "SUCCESS") summary.executed++;
    else summary.failed++;
  }
  return summary;
}

/** Pone al día las aportaciones vencidas de todos los usuarios. Un fallo con un usuario no detiene a los demás. */
export async function runAllDue(
  now = new Date(),
  log: (msg: string) => void = () => {},
): Promise<RunSummary & { users: number }> {
  const due = await prisma.contributionPlan.findMany({
    where: { active: true, nextRunAt: { lte: now } },
    select: { userId: true },
  });
  const total = { executed: 0, failed: 0, users: due.length };
  if (due.length === 0) return total;

  await marketData.refreshIfStale(); // compras al precio más reciente posible
  for (const { userId } of due) {
    try {
      const s = await runDueForUser(userId, now);
      total.executed += s.executed;
      total.failed += s.failed;
    } catch (err) {
      log(`Error al ejecutar las aportaciones de ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (total.executed + total.failed > 0) {
    log(`Aportaciones automáticas: ${total.executed} ejecutadas, ${total.failed} fallidas`);
  }
  return total;
}

/** Puesta al día al abrir la app: nunca lanza, para no romper la petición que la dispara. */
export async function catchUpUser(userId: string, log: (msg: string) => void): Promise<void> {
  try {
    const plan = await prisma.contributionPlan.findUnique({ where: { userId }, select: { active: true, nextRunAt: true } });
    if (!plan?.active || plan.nextRunAt > new Date()) return;
    await marketData.refreshIfStale();
    await runDueForUser(userId);
  } catch (err) {
    log(`No se pudieron poner al día las aportaciones: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Temporizador del proceso: comprueba las aportaciones vencidas al arrancar y cada `intervalMs`. */
export function startContributionScheduler(intervalMs: number, log: (msg: string) => void): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAllDue(new Date(), log);
    } catch (err) {
      log(`Fallo del programador de aportaciones: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const id = setInterval(tick, intervalMs);
  id.unref();
  return () => clearInterval(id);
}
