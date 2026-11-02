import { EventStatus, NotificationKind, type PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { BROADCAST_CHANNEL, keys } from './keys';

/**
 * Telling people what they asked to be told.
 *
 * Three things happen here, and only the first is really the Radar's own:
 *
 *  1. Sales open. Nothing in the project read saleOpensAt — an event sat at
 *     UPCOMING forever, which made "notify me when the sale starts" a promise
 *     about something that never happened. The worker is the right place for
 *     it: it already runs on a clock and is pinned to one replica, so two
 *     copies cannot both open the same sale and notify twice.
 *
 *  2. Seats coming back. When holds lapse on an event that had none left,
 *     that is genuinely new inventory and the thing a follower is waiting for.
 *
 *  3. The announcement itself, which is written to Postgres and pushed down
 *     the socket. Stored, not only pushed, because the person who most needs
 *     to hear that a sale opened is the one who was not looking at the page.
 *
 * Every announcement is guarded by a Redis key so it fires once. A follower
 * told four times a second that a sale has opened would unfollow immediately.
 */

/** How far ahead of a sale a "opening soon" nudge goes out. */
const OPENING_SOON_WINDOW_MS = 10 * 60 * 1000;

/** Once announced, an event is not announced again for this long. */
const ANNOUNCE_TTL_SECONDS = 24 * 60 * 60;
/** Seats returning is a recurring event, so its silence is short. */
const INVENTORY_TTL_SECONDS = 5 * 60;

const announceKey = (eventId: string, kind: NotificationKind) =>
  `radar:announced:${kind}:${eventId}`;

/**
 * Claim the right to announce something, once.
 *
 * SET NX is the whole mechanism: the first caller wins and the key expires on
 * its own, so there is no bookkeeping to get wrong and nothing to clean up.
 */
async function claimAnnouncement(
  redis: Redis,
  eventId: string,
  kind: NotificationKind,
  ttlSeconds: number,
): Promise<boolean> {
  const won = await redis.set(announceKey(eventId, kind), '1', 'EX', ttlSeconds, 'NX');
  return won === 'OK';
}

/**
 * Write one notification per follower and push it to whoever is connected.
 *
 * The rows go in with createMany so a thousand followers are one statement,
 * and the push is one message per user rather than a broadcast, because a
 * notification is nobody's business but theirs.
 */
async function notifyFollowers(
  prisma: PrismaClient,
  redis: Redis,
  eventId: string,
  kind: NotificationKind,
): Promise<number> {
  const follows = await prisma.eventFollow.findMany({
    where: {
      eventId,
      // The "opening soon" nudge is the one a follower can turn off.
      ...(kind === NotificationKind.SALE_OPENING_SOON ? { remindBeforeOpen: true } : {}),
    },
    select: { userId: true },
  });

  if (follows.length === 0) return 0;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, name: true, venue: true, startsAt: true, saleOpensAt: true, status: true },
  });
  if (!event) return 0;

  await prisma.notification.createMany({
    data: follows.map((f) => ({ userId: f.userId, eventId, kind })),
  });

  // One message per follower. The api pods turn these into a push to that
  // user's own socket room; nothing goes to the event room, because who
  // follows what is not public.
  await redis.publish(
    BROADCAST_CHANNEL,
    JSON.stringify({
      type: 'notify',
      userIds: follows.map((f) => f.userId),
      notification: {
        kind,
        eventId,
        event: {
          id: event.id,
          name: event.name,
          venue: event.venue,
          startsAt: event.startsAt,
          saleOpensAt: event.saleOpensAt,
          status: event.status,
        },
        at: Date.now(),
      },
    }),
  );

  console.log(`[radar] ${kind} for ${eventId}: ${follows.length} follower(s)`);
  return follows.length;
}

/**
 * Open any sale whose time has come.
 *
 * Only UPCOMING events are touched, and only when their saleOpensAt has
 * passed and the event has not already finished — reopening something that is
 * over would be worse than never opening it.
 */
export async function openDueSales(prisma: PrismaClient, redis: Redis): Promise<string[]> {
  const now = new Date();

  const due = await prisma.event.findMany({
    where: {
      status: EventStatus.UPCOMING,
      saleOpensAt: { lte: now },
      endsAt: { gt: now },
    },
    select: { id: true },
  });

  const opened: string[] = [];
  for (const { id } of due) {
    // Conditional on still being UPCOMING, so a status changed by an admin in
    // the meantime is not overwritten.
    const { count } = await prisma.event.updateMany({
      where: { id, status: EventStatus.UPCOMING },
      data: { status: EventStatus.LIVE },
    });
    if (count === 0) continue;

    opened.push(id);
    if (await claimAnnouncement(redis, id, NotificationKind.SALE_OPENED, ANNOUNCE_TTL_SECONDS)) {
      await notifyFollowers(prisma, redis, id, NotificationKind.SALE_OPENED);
    }
  }

  if (opened.length > 0) console.log(`[radar] opened ${opened.length} sale(s)`);
  return opened;
}

/** Nudge followers shortly before a sale they are waiting for. */
export async function announceOpeningSoon(prisma: PrismaClient, redis: Redis): Promise<number> {
  const now = Date.now();

  const soon = await prisma.event.findMany({
    where: {
      status: EventStatus.UPCOMING,
      saleOpensAt: { gt: new Date(now), lte: new Date(now + OPENING_SOON_WINDOW_MS) },
    },
    select: { id: true },
  });

  let notified = 0;
  for (const { id } of soon) {
    if (
      await claimAnnouncement(redis, id, NotificationKind.SALE_OPENING_SOON, ANNOUNCE_TTL_SECONDS)
    ) {
      notified += await notifyFollowers(prisma, redis, id, NotificationKind.SALE_OPENING_SOON);
    }
  }
  return notified;
}

/**
 * Tell followers when seats come back on sale.
 *
 * Only worth saying when there were none: a hold lapsing on an event with a
 * thousand free seats is not news. So this fires on the transition from
 * nothing left to something left, which is exactly the moment a follower who
 * missed out has been waiting for.
 */
const lastAvailable = new Map<string, number>();

export async function announceReturnedInventory(
  prisma: PrismaClient,
  redis: Redis,
  event: { id: string; _count: { seats: number } },
): Promise<boolean> {
  const now = Date.now();
  const [soldCount, heldCount] = await Promise.all([
    redis.scard(keys.sold(event.id)),
    redis.zcount(keys.holds(event.id), now, '+inf'),
  ]);

  const available = Math.max(0, event._count.seats - soldCount - heldCount);
  const before = lastAvailable.get(event.id);
  lastAvailable.set(event.id, available);

  // Nothing to compare against on the first tick, and a first reading of zero
  // is not a transition.
  if (before === undefined) return false;
  if (!(before === 0 && available > 0)) return false;

  if (
    !(await claimAnnouncement(
      redis,
      event.id,
      NotificationKind.INVENTORY_RETURNED,
      INVENTORY_TTL_SECONDS,
    ))
  ) {
    return false;
  }

  await notifyFollowers(prisma, redis, event.id, NotificationKind.INVENTORY_RETURNED);
  return true;
}

/** Forget an event's availability history, for tests. */
export function forgetAvailability(eventId?: string) {
  if (eventId) lastAvailable.delete(eventId);
  else lastAvailable.clear();
}
