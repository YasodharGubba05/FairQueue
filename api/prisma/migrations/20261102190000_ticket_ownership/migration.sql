-- Ownership becomes a property of the ticket rather than of the order.
--
-- The order records who PAID, which is history and must never be edited. A
-- transfer changes who holds the ticket, so that has to live somewhere else.
-- Until now ownership was read transitively through the order, which only
-- works while a ticket cannot move.

ALTER TABLE "Ticket" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Ticket" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Every existing ticket is still held by whoever bought it.
UPDATE "Ticket" t SET "ownerId" = o."userId" FROM "Order" o WHERE o.id = t."orderId";

-- No ticket may exist without an owner.
ALTER TABLE "Ticket" ALTER COLUMN "ownerId" SET NOT NULL;

CREATE INDEX "Ticket_ownerId_idx" ON "Ticket"("ownerId");

ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only record of every hand a ticket has passed through. "Who had it
-- before" is the first question anyone investigating a dispute asks.
CREATE TABLE "TicketTransfer" (
  "id"         TEXT NOT NULL,
  "ticketId"   TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId"   TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketTransfer_ticketId_idx"   ON "TicketTransfer"("ticketId");
CREATE INDEX "TicketTransfer_toUserId_idx"   ON "TicketTransfer"("toUserId");
CREATE INDEX "TicketTransfer_fromUserId_idx" ON "TicketTransfer"("fromUserId");

ALTER TABLE "TicketTransfer"
  ADD CONSTRAINT "TicketTransfer_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketTransfer"
  ADD CONSTRAINT "TicketTransfer_fromUserId_fkey"
  FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketTransfer"
  ADD CONSTRAINT "TicketTransfer_toUserId_fkey"
  FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
