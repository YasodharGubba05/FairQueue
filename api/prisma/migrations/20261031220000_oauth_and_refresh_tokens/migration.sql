-- A password is now optional: an account that only ever signs in through a
-- provider has none, and must never be able to pass password verification.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Set only when a provider asserts the address is verified, or when we issued
-- the password ourselves.
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;

-- Existing password accounts were created by us, so their addresses are known.
UPDATE "User" SET "emailVerified" = true WHERE "passwordHash" IS NOT NULL;

-- A provider account linked to a user. Keyed on the provider's immutable
-- subject rather than the email, which a workspace admin can reassign.
CREATE TABLE "OAuthIdentity" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "provider"  TEXT NOT NULL,
  "subject"   TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLogin" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthIdentity_pkey" PRIMARY KEY ("id")
);

-- One account per provider subject, enforced by the database rather than by a
-- check that two concurrent logins could race past.
CREATE UNIQUE INDEX "OAuthIdentity_provider_subject_key" ON "OAuthIdentity"("provider", "subject");
CREATE INDEX "OAuthIdentity_userId_idx" ON "OAuthIdentity"("userId");

ALTER TABLE "OAuthIdentity"
  ADD CONSTRAINT "OAuthIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Refresh tokens. Only a hash is stored, so a database leak does not hand over
-- live sessions. Rotated on every use and chained by family, so presenting a
-- spent token kills every descendant of that login.
CREATE TABLE "RefreshToken" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "tokenHash"     TEXT NOT NULL,
  "family"        TEXT NOT NULL,
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"     TIMESTAMP(3),
  "revokedReason" TEXT,
  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx"    ON "RefreshToken"("userId");
CREATE INDEX "RefreshToken_family_idx"    ON "RefreshToken"("family");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
