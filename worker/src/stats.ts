import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { keys, TTL } from './keys';

/**
 * The numbers Mission Control draws, worked out once a second by the worker and
 * broadcast to every dashboard — the same trick as the queue position. One
 * message per event per second, however many people are watching.
 *
 * Rates are derived from the change since the last tick rather than stored as a
 * time series: the dashboard wants "purchases per second right now", and two
 * integers and a subtraction answer that without a time-series database.
 */
type Sample = { admitted: number; purchases: number; tickets: number; at: number };

const previous = new Map<string, Sample>();

/** The oversold query hits Postgres, so it runs every few ticks, not every one. */
const OVERSOLD_EVERY_TICKS = 5;
const oversoldCache = new Map<string, { value: number; tick: number }>();
let tickCount = 0;

export function nextTick() {
  tickCount += 1;
}

async function readOversold(prisma: PrismaClient, eventId: string): Promise<number> {
  const cached = oversoldCache.get(eventId);
  if (cached && tickCount - cached.tick < OVERSOLD_EVERY_TICKS) return cached.value;

  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT "seatId" FROM "Ticket"
      WHERE "eventId" = ${eventId}
      GROUP BY "seatId" HAVING COUNT(*) > 1
    ) AS duplicated
  `;
  const value = Number(rows[0]?.count ?? 0);
  oversoldCache.set(eventId, { value, tick: tickCount });
  return value;
}

export async function buildStats(
  redis: Redis,
  prisma: PrismaClient,
  event: { id: string; admitPerSec: number; status: string },
  totalSeats: number,
) {
  const now = Date.now();

  const [joinedRaw, admittedRaw, soldCount, holdsRaw, purchasesRaw, ticketsRaw, blockedRaw, noPassRaw, livePods] =
    await Promise.all([
      redis.get(keys.queueNext(event.id)),
      redis.get(keys.admitted(event.id)),
      redis.scard(keys.sold(event.id)),
      redis.get(keys.stat(event.id, 'holds')),
      redis.get(keys.stat(event.id, 'purchases')),
      redis.get(keys.stat(event.id, 'tickets')),
      redis.get(keys.stat(event.id, 'blocked')),
      redis.get(keys.stat(event.id, 'nopass')),
      redis.zcount(keys.pods, now - TTL.POD_HEARTBEAT_SECONDS * 1000, '+inf'),
    ]);

  const joined = Number(joinedRaw ?? 0);
  const admitted = Number(admittedRaw ?? 0);
  const purchases = Number(purchasesRaw ?? 0);
  const tickets = Number(ticketsRaw ?? 0);

  const prev = previous.get(event.id);
  const seconds = prev ? (now - prev.at) / 1000 : 0;
  const rate = (current: number, before: number) =>
    seconds > 0 ? Math.max(0, (current - before) / seconds) : 0;

  const stats = {
    type: 'stats' as const,
    eventId: event.id,
    status: event.status,
    joined,
    admitted,
    inQueue: Math.max(0, joined - admitted),
    admitPerSec: event.admitPerSec,
    admittedRate: prev ? rate(admitted, prev.admitted) : 0,
    purchaseRate: prev ? rate(purchases, prev.purchases) : 0,
    ticketRate: prev ? rate(tickets, prev.tickets) : 0,
    seatsLeft: Math.max(0, totalSeats - soldCount),
    totalSeats,
    holds: Number(holdsRaw ?? 0),
    purchases,
    ticketsSold: tickets,
    blocked: Number(blockedRaw ?? 0),
    noPass: Number(noPassRaw ?? 0),
    livePods,
    oversold: await readOversold(prisma, event.id),
    at: now,
  };

  previous.set(event.id, { admitted, purchases, tickets, at: now });
  return stats;
}

/** Drop pods that stopped checking in, so the dashboard count stays honest. */
export async function prunePods(redis: Redis) {
  await redis.zremrangebyscore(keys.pods, '-inf', Date.now() - TTL.POD_HEARTBEAT_SECONDS * 6 * 1000);
}
