-- When the doors close.
--
-- Visibility is derived from this rather than from startsAt, because an event
-- that began an hour ago is still on and must stay listed.
--
-- Existing rows get a three hour show as a sensible default; the column is
-- then NOT NULL, because an event with no end can never complete.
ALTER TABLE "Event" ADD COLUMN "endsAt" TIMESTAMP(3);
UPDATE "Event" SET "endsAt" = "startsAt" + INTERVAL '3 hours' WHERE "endsAt" IS NULL;
ALTER TABLE "Event" ALTER COLUMN "endsAt" SET NOT NULL;

-- Every public listing filters on status and endsAt together.
CREATE INDEX "Event_status_endsAt_idx" ON "Event"("status", "endsAt");
