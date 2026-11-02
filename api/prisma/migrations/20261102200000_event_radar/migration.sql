-- Following an event, and being told about it.

CREATE TYPE "NotificationKind" AS ENUM (
  'SALE_OPENED',
  'INVENTORY_RETURNED',
  'SALE_OPENING_SOON'
);

-- Following is a many-to-many fact, so it gets its own table. The unique
-- constraint makes following twice impossible in the database rather than
-- only in the handler.
CREATE TABLE "EventFollow" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "eventId"          TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remindBeforeOpen" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "EventFollow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventFollow_userId_eventId_key" ON "EventFollow"("userId", "eventId");
CREATE INDEX "EventFollow_eventId_idx" ON "EventFollow"("eventId");
CREATE INDEX "EventFollow_userId_idx"  ON "EventFollow"("userId");

ALTER TABLE "EventFollow"
  ADD CONSTRAINT "EventFollow_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventFollow"
  ADD CONSTRAINT "EventFollow_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Notifications are stored, not only pushed, because the person who most needs
-- to hear that a sale opened is the one who was not looking when it did.
CREATE TABLE "Notification" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "eventId"   TEXT NOT NULL,
  "kind"      "NotificationKind" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt"    TIMESTAMP(3),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- The unread count is the query this table exists to answer quickly.
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_eventId_idx"       ON "Notification"("eventId");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
