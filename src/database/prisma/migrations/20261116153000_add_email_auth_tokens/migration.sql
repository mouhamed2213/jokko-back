CREATE TYPE "AuthTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'EMAIL_CHANGE');

ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "super_admins" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "auth_tokens" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "userId" INTEGER,
    "superAdminId" INTEGER,
    "targetEmail" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_tokens_owner_check" CHECK (
      (CASE WHEN "userId" IS NULL THEN 0 ELSE 1 END) +
      (CASE WHEN "superAdminId" IS NULL THEN 0 ELSE 1 END) = 1
    )
);

CREATE UNIQUE INDEX "auth_tokens_tokenHash_key" ON "auth_tokens"("tokenHash");
CREATE INDEX "auth_tokens_userId_type_expiresAt_idx" ON "auth_tokens"("userId", "type", "expiresAt");
CREATE INDEX "auth_tokens_superAdminId_type_expiresAt_idx" ON "auth_tokens"("superAdminId", "type", "expiresAt");

ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_superAdminId_fkey"
  FOREIGN KEY ("superAdminId") REFERENCES "super_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
