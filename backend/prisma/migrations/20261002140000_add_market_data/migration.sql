-- AlterTable
ALTER TABLE "Fund" ADD COLUMN     "lastPriceUpdate" TIMESTAMP(3),
ADD COLUMN     "ticker" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Fund_ticker_key" ON "Fund"("ticker");
