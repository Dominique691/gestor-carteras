import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ISINs reales; los NAV son ficticios (solo para desarrollo).
const funds = [
  { isin: "IE00B03HD191", name: "Vanguard Global Stock Index Fund EUR Acc", category: "Renta Variable", currentNAV: "512.3400" },
  { isin: "IE0032620787", name: "Vanguard U.S. 500 Stock Index Fund EUR Acc", category: "Renta Variable", currentNAV: "47.8100" },
  { isin: "IE0031786696", name: "Vanguard Emerging Markets Stock Index Fund EUR Acc", category: "Renta Variable", currentNAV: "38.2500" },
  { isin: "IE0007987690", name: "Vanguard European Stock Index Fund EUR Acc", category: "Renta Variable", currentNAV: "29.6700" },
  { isin: "IE00B4L5Y983", name: "iShares Core MSCI World UCITS ETF USD Acc", category: "Renta Variable", currentNAV: "98.4200" },
  { isin: "IE00B5BMR087", name: "iShares Core S&P 500 UCITS ETF USD Acc", category: "Renta Variable", currentNAV: "612.7500" },
  { isin: "IE00BKM4GZ66", name: "iShares Core MSCI EM IMI UCITS ETF USD Acc", category: "Renta Variable", currentNAV: "32.1800" },
  { isin: "LU1681043599", name: "Amundi MSCI World UCITS ETF Acc", category: "Renta Variable", currentNAV: "582.9000" },
  { isin: "IE00BK5BQT80", name: "Vanguard FTSE All-World UCITS ETF USD Acc", category: "Renta Variable", currentNAV: "128.3600" },
  { isin: "IE00B18GC888", name: "Vanguard Global Bond Index Fund EUR Hedged Acc", category: "Renta Fija", currentNAV: "121.4500" },
  { isin: "IE00BDBRDM35", name: "iShares Core Global Aggregate Bond UCITS ETF EUR Hedged Acc", category: "Renta Fija", currentNAV: "5.2300" },
  { isin: "IE00B4WXJJ64", name: "iShares Core Euro Government Bond UCITS ETF EUR Dist", category: "Renta Fija", currentNAV: "122.8800" },
  { isin: "IE00B3F81R35", name: "iShares Core Euro Corporate Bond UCITS ETF EUR Dist", category: "Renta Fija", currentNAV: "131.0600" },
];

// Usuario de demostración. Cumple la política de contraseñas de la API (≥ 8, letra y número).
const DEMO_USER = { email: "usuario@test.com", password: "Password123!" };

// Cartera de ejemplo: [ISIN, tipo, participaciones, precio, hace cuántos días]
const demoTransactions: [string, "BUY" | "SELL", number, number, number][] = [
  ["IE00B03HD191", "BUY", 10, 480, 180],
  ["IE00B03HD191", "BUY", 5, 500, 90],
  ["IE00B5BMR087", "BUY", 8, 560, 120],
  ["IE0031786696", "BUY", 40, 35, 100],
  ["IE00B18GC888", "BUY", 30, 118, 150],
  ["IE00B18GC888", "SELL", 5, 120, 30],
  ["IE00B4WXJJ64", "BUY", 12, 120, 60],
];

// Objetivo de la cartera de ejemplo (suma 100 %).
const demoTargets: [string, number][] = [
  ["IE00B03HD191", 40],
  ["IE00B5BMR087", 20],
  ["IE0031786696", 10],
  ["IE00B18GC888", 20],
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
      update: { name: fund.name, category: fund.category, currentNAV: fund.currentNAV },
      create: fund,
    });
  }
  await seedDemoUser();
  console.log(`Seed completado: ${funds.length} fondos y usuario de demostración ${DEMO_USER.email}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
