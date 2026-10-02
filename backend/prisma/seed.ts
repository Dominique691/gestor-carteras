import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface SeedFund {
  isin: string;
  name: string;
  category: "Renta Variable" | "Renta Fija";
  /** NAV inicial. Solo se usa al crear el fondo; una sincronización de mercado lo sustituye. */
  currentNAV: string;
  /** Símbolo en Yahoo Finance (cotización en EUR). Obligatorio: el catálogo solo contiene fondos que cotizan. */
  ticker: string;
}

// Catálogo: solo ETF con cotización real. ISINs y tickers reales; los NAV iniciales son cotizaciones de referencia
// que POST /api/funds/sync-prices (y el refresco automático) sustituyen por el precio de mercado.
const funds: SeedFund[] = [
  // ETF de renta variable
  { isin: "IE00B4L5Y983", ticker: "EUNL.DE", name: "iShares Core MSCI World UCITS ETF USD Acc", category: "Renta Variable", currentNAV: "130.3800" },
  { isin: "IE00BK5BQT80", ticker: "VWCE.DE", name: "Vanguard FTSE All-World UCITS ETF USD Acc", category: "Renta Variable", currentNAV: "171.6000" },
  { isin: "IE00B5BMR087", ticker: "SXR8.DE", name: "iShares Core S&P 500 UCITS ETF USD Acc", category: "Renta Variable", currentNAV: "741.5800" },
  { isin: "IE00BFMXXD54", ticker: "VUAA.DE", name: "Vanguard S&P 500 UCITS ETF USD Acc", category: "Renta Variable", currentNAV: "133.0100" },
  { isin: "IE00BJ0KDQ92", ticker: "XDWD.DE", name: "Xtrackers MSCI World UCITS ETF 1C", category: "Renta Variable", currentNAV: "142.7600" },
  { isin: "IE00BKM4GZ66", ticker: "IS3N.DE", name: "iShares Core MSCI EM IMI UCITS ETF USD Acc", category: "Renta Variable", currentNAV: "49.2550" },
  { isin: "LU1681043599", ticker: "CW8.PA", name: "Amundi MSCI World UCITS ETF Acc", category: "Renta Variable", currentNAV: "708.9100" },
  // ETF de renta fija
  { isin: "IE00B4WXJJ64", ticker: "EUNH.DE", name: "iShares Core Euro Government Bond UCITS ETF EUR Dist", category: "Renta Fija", currentNAV: "104.4150" },
  { isin: "IE00B3F81R35", ticker: "EUN5.DE", name: "iShares Core Euro Corporate Bond UCITS ETF EUR Dist", category: "Renta Fija", currentNAV: "115.9200" },
  { isin: "IE00BDBRDM35", ticker: "EUNA.DE", name: "iShares Core Global Aggregate Bond UCITS ETF EUR Hedged Acc", category: "Renta Fija", currentNAV: "4.8129" },
  { isin: "IE00BG47KB92", ticker: "VAGF.DE", name: "Vanguard Global Aggregate Bond UCITS ETF EUR Hedged Acc", category: "Renta Fija", currentNAV: "23.0810" },
];

// Usuario de demostración. Cumple la política de contraseñas de la API (≥ 8, letra y número).
const DEMO_USER = { email: "usuario@test.com", password: "Password123!" };

// Cartera de ejemplo: [ISIN, tipo, participaciones, precio, hace cuántos días]
const demoTransactions: [string, "BUY" | "SELL", number, number, number][] = [
  ["IE00B4L5Y983", "BUY", 40, 112, 180], // iShares Core MSCI World
  ["IE00B4L5Y983", "BUY", 20, 120, 90],
  ["IE00B5BMR087", "BUY", 8, 640, 120], // iShares Core S&P 500
  ["IE00BKM4GZ66", "BUY", 31, 44, 100], // iShares Core MSCI EM IMI
  ["IE00BG47KB92", "BUY", 150, 22.4, 150], // Vanguard Global Aggregate Bond
  ["IE00BG47KB92", "SELL", 20, 23, 30],
  ["IE00B4WXJJ64", "BUY", 12, 103, 60], // iShares Core Euro Government Bond
];

// Objetivo de la cartera de ejemplo (suma 100 %).
const demoTargets: [string, number][] = [
  ["IE00B4L5Y983", 40],
  ["IE00B5BMR087", 20],
  ["IE00BKM4GZ66", 10],
  ["IE00BG47KB92", 20],
  ["IE00B4WXJJ64", 10],
];

async function seedDemoUser() {
  const passwordHash = await bcrypt.hash(DEMO_USER.password, 12);
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER.email },
    update: { passwordHash },
    create: { email: DEMO_USER.email, passwordHash },
  });

  const fundByIsin = new Map((await prisma.fund.findMany()).map((f) => [f.isin, f.id]));
  const fundId = (isin: string) => {
    const id = fundByIsin.get(isin);
    if (!id) throw new Error(`Fondo ${isin} no encontrado en el catálogo`);
    return id;
  };
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

  // Se recrea siempre la cartera de demo, de modo que ejecutar el seed varias veces no la duplica.
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { userId: user.id } }),
    prisma.targetAllocation.deleteMany({ where: { userId: user.id } }),
    prisma.transaction.createMany({
      data: demoTransactions.map(([isin, type, shares, pricePerShare, days]) => ({
        userId: user.id,
        fundId: fundId(isin),
        type,
        shares,
        pricePerShare,
        transactionDate: daysAgo(days),
      })),
    }),
    prisma.targetAllocation.createMany({
      data: demoTargets.map(([isin, targetPercentage]) => ({
        userId: user.id,
        fundId: fundId(isin),
        targetPercentage,
      })),
    }),
  ]);
}

async function main() {
  for (const fund of funds) {
    await prisma.fund.upsert({
      where: { isin: fund.isin },
      // En un fondo ya existente NO se toca currentNAV: así repetir el seed no pisa precios sincronizados.
      update: { name: fund.name, category: fund.category, ticker: fund.ticker },
      create: fund,
    });
  }
  await seedDemoUser();
  const retired = await retireUntradedFunds();
  console.log(`Seed completado: ${funds.length} fondos y usuario de demostración ${DEMO_USER.email}.`);
  if (retired.removed > 0) console.log(`Fondos sin cotización retirados del catálogo: ${retired.removed}.`);
  if (retired.kept.length > 0) {
    console.warn(
      `Aviso: ${retired.kept.length} fondo(s) sin cotización siguen en la base de datos porque tienen operaciones u ` +
        `objetivos asociados (no se muestran en el catálogo): ${retired.kept.join(", ")}.`,
    );
  }
}

/**
 * El catálogo solo debe contener fondos que cotizan. Elimina los fondos sin ticker que quedaron de versiones
 * anteriores, pero únicamente si nadie los usa: nunca se borran operaciones ni objetivos de un usuario.
 */
async function retireUntradedFunds() {
  const untraded = await prisma.fund.findMany({
    where: { ticker: null },
    include: { _count: { select: { transactions: true, targetAllocations: true } } },
  });
  const unused = untraded.filter((f) => f._count.transactions === 0 && f._count.targetAllocations === 0);
  await prisma.fund.deleteMany({ where: { id: { in: unused.map((f) => f.id) } } });
  return {
    removed: unused.length,
    kept: untraded.filter((f) => !unused.includes(f)).map((f) => f.isin),
  };
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
