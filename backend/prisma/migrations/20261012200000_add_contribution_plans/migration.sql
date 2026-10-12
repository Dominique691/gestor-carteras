-- CreateEnum
CREATE TYPE "ContributionFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ContributionRunStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "ContributionPlan" (
    "userId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "frequency" "ContributionFrequency" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionPlan_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ContributionRun" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "ContributionRunStatus" NOT NULL,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,

    CONSTRAINT "ContributionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContributionPlan_active_nextRunAt_idx" ON "ContributionPlan"("active", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionRun_userId_scheduledFor_key" ON "ContributionRun"("userId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "ContributionPlan" ADD CONSTRAINT "ContributionPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionRun" ADD CONSTRAINT "ContributionRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

