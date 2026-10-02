import "dotenv/config";
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

async function main() {
  for (const fund of funds) {
    await prisma.fund.upsert({
      where: { isin: fund.isin },
      update: { name: fund.name, category: fund.category, currentNAV: fund.currentNAV },
      create: fund,
    });
  }
  console.log(`Seed completado: ${funds.length} fondos.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
