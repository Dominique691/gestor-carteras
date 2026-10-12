-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationExpires" TIMESTAMP(3),
ADD COLUMN     "emailVerificationToken" TEXT,
ADD COLUMN     "isEmailVerified" BOOLEAN NOT NULL DEFAULT false;

-- Las cuentas creadas antes de exigir la verificación se consideran verificadas (si no, no podrían entrar).
UPDATE "User" SET "isEmailVerified" = true;

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerificationToken_key" ON "User"("emailVerificationToken");
