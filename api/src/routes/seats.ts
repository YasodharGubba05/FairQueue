import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { redis } from '../redis';
import { keys } from '../keys';
import { isNaive } from '../env';

export const seatsRouter = Router();

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

  let soldSeatIds = new Set<string>();
  let heldSeatIds = new Set<string>();

  if (isNaive) {
    // In naive mode, read sold seats directly from Postgres tickets.
    const tickets = await prisma.ticket.findMany({
      where: { eventId },
      select: { seatId: true },
    });
    soldSeatIds = new Set(tickets.map((t) => t.seatId));
  } else {
    // In fairqueue mode, Redis sold set has immediate sold status.
    const redisSold = await redis.smembers(keys.sold(eventId)).catch(() => []);
    if (redisSold.length > 0) {
      soldSeatIds = new Set(redisSold);
    } else {
      const tickets = await prisma.ticket.findMany({
        where: { eventId },
        select: { seatId: true },
      });
      soldSeatIds = new Set(tickets.map((t) => t.seatId));
    }

    // Active holds in Redis:
    const holdKeys = await redis.keys(keys.hold(eventId, '*')).catch(() => []);
    for (const k of holdKeys) {
      const seatId = k.split(':').pop();
      if (seatId && !soldSeatIds.has(seatId)) {
        heldSeatIds.add(seatId);
      }
    }
  }

  const result = seats.map((s) => {
    let status: 'available' | 'held' | 'sold' = 'available';
    if (soldSeatIds.has(s.id)) {
      status = 'sold';
    } else if (heldSeatIds.has(s.id)) {
      status = 'held';
    }

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
