-- Where an event's real-world details came from.
--
-- This describes the event only. FairQueue's seat inventory, prices, payments
-- and tickets are simulated for every event without exception, including the
-- ones whose details are genuine.
CREATE TYPE "EventSourceKind" AS ENUM ('SEEDED', 'TICKETMASTER', 'VERIFIED');

ALTER TABLE "Event"
  ADD COLUMN "source"       "EventSourceKind" NOT NULL DEFAULT 'SEEDED',
  ADD COLUMN "externalId"   TEXT,
  ADD COLUMN "category"     TEXT,
  ADD COLUMN "city"         TEXT,
  ADD COLUMN "country"      TEXT,
  ADD COLUMN "sourceUrl"    TEXT,
  ADD COLUMN "sourceName"   TEXT,
  ADD COLUMN "verifiedAt"   TIMESTAMP(3),
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

-- One row per provider event. Postgres treats NULLs as distinct, so any number
-- of seeded events coexist (all with a NULL externalId) while a provider event
-- can only land once and a re-sync updates it rather than duplicating it.
CREATE UNIQUE INDEX "Event_source_externalId_key" ON "Event"("source", "externalId");

CREATE INDEX "Event_city_idx" ON "Event"("city");
CREATE INDEX "Event_category_idx" ON "Event"("category");
