import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { redis } from '../redis';
import { keys } from '../keys';
import { isNaive } from '../env';

export const seatsRouter = Router();

/**
 * Which seats are gone, read from Redis rather than Postgres.
 *
 * Redis is the live picture during a sale and Postgres is the permanent record.
 * If the sold set is missing — a fresh Redis, or a restart mid-sale — it is
 * rebuilt once from the tickets table, which is the thing we never lose.
 */
async function readSoldSeatIds(eventId: string): Promise<Set<string>> {
  const soldKey = keys.sold(eventId);
  if ((await redis.exists(soldKey)) === 1) {
    return new Set(await redis.smembers(soldKey));
  }

  const tickets = await prisma.ticket.findMany({ where: { eventId }, select: { seatId: true } });
  if (tickets.length > 0) {
    await redis.sadd(soldKey, ...tickets.map((t) => t.seatId));
  }
  return new Set(tickets.map((t) => t.seatId));
}

seatsRouter.get('/api/events/:eventId/seats', async (req: Request, res: Response) => {
  const { eventId } = req.params;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, status: true },
  });

  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  const seats = await prisma.seat.findMany({
    where: { eventId },
    orderBy: [{ section: 'asc' }, { row: 'asc' }, { number: 'asc' }],
  });

  let soldSeatIds: Set<string>;
  const heldSeatIds = new Set<string>();

  if (isNaive) {
    // Naive mode has no Redis state at all: no queue, no holds, no locks.
    const tickets = await prisma.ticket.findMany({
      where: { eventId },
      select: { seatId: true },
    });
    soldSeatIds = new Set(tickets.map((t) => t.seatId));
  } else {
    soldSeatIds = await readSoldSeatIds(eventId);

    // Live holds come straight off the index, scored by when they run out, so
    // anything already expired is simply out of range. Reading them by key
    // pattern instead would mean a full keyspace scan on every seat map load.
    const held = await redis.zrangebyscore(keys.holds(eventId), Date.now(), '+inf');
    for (const seatId of held) {
      if (!soldSeatIds.has(seatId)) heldSeatIds.add(seatId);
    }
  }

  const result = seats.map((s) => {
    let status: 'available' | 'held' | 'sold' = 'available';
    if (soldSeatIds.has(s.id)) status = 'sold';
    else if (heldSeatIds.has(s.id)) status = 'held';

    return {
      id: s.id,
      section: s.section,
      row: s.row,
      number: s.number,
      price: s.price,
      x: s.x,
      y: s.y,
      status,
    };
  });

  res.json({ seats: result });
});
