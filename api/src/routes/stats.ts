import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { redis } from '../redis';
import { keys, TTL } from '../keys';
import { STAT } from '../stats';

export const statsRouter = Router();

export type EventStats = {
  eventId: string;
  inQueue: number;
  joined: number;
  admitted: number;
  seatsLeft: number;
  totalSeats: number;
  holds: number;
  purchases: number;
  ticketsSold: number;
  blocked: number;
  noPass: number;
  livePods: number;
  /** Counted in Postgres. The whole project is the claim that this stays 0. */
  oversold: number;
  at: number;
};

/**
 * Everything Mission Control shows, in one read.
 *
 * All of it comes from Redis except the oversold count and the seat total,
 * because "how many seats were sold twice" is a question only the permanent
 * record can answer honestly — asking Redis would be asking the thing that is
 * supposed to prevent it whether it prevented it.
 */
export async function readEventStats(eventId: string): Promise<EventStats> {
  const now = Date.now();

  const [
    joinedRaw,
    admittedRaw,
    soldCount,
    holdsRaw,
    purchasesRaw,
    ticketsRaw,
    blockedRaw,
    noPassRaw,
    livePods,
    totalSeats,
    oversoldRows,
  ] = await Promise.all([
    redis.get(keys.queueNext(eventId)),
    redis.get(keys.admitted(eventId)),
    redis.scard(keys.sold(eventId)),
    redis.get(keys.stat(eventId, STAT.HOLDS)),
    redis.get(keys.stat(eventId, STAT.PURCHASES)),
    redis.get(keys.stat(eventId, STAT.TICKETS)),
    redis.get(keys.stat(eventId, STAT.BLOCKED)),
    redis.get(keys.stat(eventId, STAT.NO_PASS)),
    redis.zcount(keys.pods, now - TTL.POD_HEARTBEAT_SECONDS * 1000, '+inf'),
    prisma.seat.count({ where: { eventId } }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT "seatId" FROM "Ticket"
        WHERE "eventId" = ${eventId}
        GROUP BY "seatId" HAVING COUNT(*) > 1
      ) AS duplicated
    `,
  ]);

  const joined = Number(joinedRaw ?? 0);
  const admitted = Number(admittedRaw ?? 0);

  return {
    eventId,
    joined,
    admitted,
    inQueue: Math.max(0, joined - admitted),
    seatsLeft: Math.max(0, totalSeats - soldCount),
    totalSeats,
    holds: Number(holdsRaw ?? 0),
    purchases: Number(purchasesRaw ?? 0),
    ticketsSold: Number(ticketsRaw ?? 0),
    blocked: Number(blockedRaw ?? 0),
    noPass: Number(noPassRaw ?? 0),
    livePods,
    oversold: Number(oversoldRows[0]?.count ?? 0),
    at: now,
  };
}

statsRouter.get('/api/events/:eventId/stats', async (req: Request, res: Response) => {
  const { eventId } = req.params;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  res.json(await readEventStats(eventId));
});
