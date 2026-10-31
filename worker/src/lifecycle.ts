import { EventStatus, type PrismaClient } from '@prisma/client';

/**
 * Retiring events that are over.
 *
 * A real ticketing site does not keep last month's concert in its listings,
 * and nobody should be able to join a queue for a show that has already
 * finished. The worker is the right place for this: it is the one process
 * that already runs on a clock, and it is pinned to a single replica, so two
 * copies can never race to retire the same event.
 *
 * Only the status moves. Orders, tickets and seats are untouched — somebody
 * who went to the show keeps their ticket, and their order page keeps working
 * long after the event has left the listings.
 */

/** Postgres does the comparison, so the sweep is one statement. */
const SWEEP_EVERY_TICKS = 30;

let ticks = 0;

export async function completeFinishedEvents(prisma: PrismaClient): Promise<number> {
  // Once every thirty seconds rather than every second: an event that ended a
  // moment ago is already unbuyable, because every booking path checks endsAt
  // directly as well as the status.
  ticks += 1;
  if (ticks % SWEEP_EVERY_TICKS !== 1) return 0;

  const { count } = await prisma.event.updateMany({
    where: {
      endsAt: { lte: new Date() },
      // Cancelled stays cancelled: it never happened, so it was never
      // completed, and the distinction matters to whoever reads it later.
      status: { notIn: [EventStatus.COMPLETED, EventStatus.CANCELLED] },
    },
    data: { status: EventStatus.COMPLETED },
  });

  if (count > 0) console.log(`[worker] retired ${count} finished event(s)`);
  return count;
}
