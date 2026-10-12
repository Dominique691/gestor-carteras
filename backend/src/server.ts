import "dotenv/config";
import { buildApp } from "./app.js";
import { startContributionScheduler } from "./services/contributions.service.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  const app = await buildApp();
  await app.listen({ port, host });

  // Aportaciones automáticas: comprobación al arrancar y periódica mientras el proceso está despierto.
  const minutes = Number(process.env.CONTRIBUTIONS_CHECK_MINUTES ?? 15);
  if (Number.isFinite(minutes) && minutes > 0) {
    startContributionScheduler(minutes * 60_000, (m) => app.log.info(`[contributions] ${m}`));
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
