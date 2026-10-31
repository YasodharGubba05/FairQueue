import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { redis } from '../redis';
import { keys } from '../keys';
import { requireAuth } from '../middleware/auth';
import { isNaive } from '../env';
import { MARK_SOLD_LUA, VERIFY_HOLDS_LUA } from '../lua/hold';
import { queueSeatUpdate } from '../seatUpdates';
import { rateLimit } from '../middleware/rateLimit';
import { bumpStat, STAT } from '../stats';

// Buying is the one action a real buyer does once. Anything repeatedly
// hammering it is not shopping.
const checkoutLimit = rateLimit('checkout', { perUser: 10 });

export const checkoutRouter = Router();

const checkoutSchema = z.object({
  seatIds: z.array(z.string().min(1)).min(1),
  // Mock payment. Nothing here is stored or sent anywhere; a card number
  // ending in 0000 is treated as declined so the UI has a failure to show.
  payment: z
    .object({
      cardNumber: z.string().min(12).max(24),
      name: z.string().min(1),
    })
    .optional(),
});

/** Why a checkout was refused, in words a buyer can act on. */
const REFUSALS: Record<string, { status: number; message: string }> = {
  EXPIRED: { status: 409, message: 'Your hold ran out — those seats are back on sale' },
  SOLD: { status: 409, message: 'One of those seats was just sold' },
  HELD: { status: 409, message: 'You are not holding one of those seats' },
};

checkoutRouter.post(
  '/api/events/:eventId/checkout',
  requireAuth,
  checkoutLimit,
  async (req: Request, res: Response) => {
    const { eventId } = req.params;
    const user = req.user!;

    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'seatIds must be a non-empty array of seat IDs' });
      return;
    }

    const { seatIds, payment } = parsed.data;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    if (seatIds.length > event.maxSeatsPerUser) {
      res.status(400).json({ error: `Cannot purchase more than ${event.maxSeatsPerUser} seats` });
      return;
    }

    const seats = await prisma.seat.findMany({ where: { eventId, id: { in: seatIds } } });
    if (seats.length !== seatIds.length) {
      res.status(400).json({ error: 'One or more invalid seats selected' });
      return;
    }

    if (isNaive) {
      await naiveCheckout(res, { eventId, userId: user.id, seatIds, seats });
      return;
    }

    // 1. No pass, no sale. Holding seats already needs one, so this is belt and
    //    braces — but it means a bot pointed straight at checkout is turned
    //    away here by the same rule that governs the queue, and it is counted.
    if ((await redis.exists(keys.pass(eventId, user.id))) === 0) {
      bumpStat(eventId, STAT.NO_PASS);
      res.status(403).json({ error: 'You need to go through the queue before buying' });
      return;
    }

    // 2. Confirm the holds are still ours. A buyer can sit on the payment form
    //    for longer than the hold lasts, and those seats belong to whoever is
    //    looking at them now.
    const [outcome, detail] = (await redis.eval(
      VERIFY_HOLDS_LUA,
      1,
      keys.sold(eventId),
      eventId,
      user.id,
      String(seatIds.length),
      ...seatIds,
    )) as [string, string];

    if (outcome !== 'OK') {
      const refusal = REFUSALS[outcome];
      res
        .status(refusal?.status ?? 409)
        .json({ error: refusal?.message ?? 'Those seats are no longer yours', seatId: detail });
      return;
    }

    // 3. Mock payment, where a real integration would go.
    if (payment && payment.cardNumber.replace(/\s/g, '').endsWith('0000')) {
      res.status(402).json({ error: 'Your card was declined — the seats are still yours' });
      return;
    }

    const total = seats.reduce((acc, s) => acc + s.price, 0);

    // 4. One transaction: either the order and every ticket land, or none do.
    //    The UNIQUE(eventId, seatId) index is the last line of defense — even
    //    if every lock above somehow failed, the database physically cannot
    //    store the same seat twice, and this write fails instead.
    try {
      const order = await prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: { userId: user.id, eventId, total },
        });
        await tx.ticket.createMany({
          data: seats.map((seat) => ({ orderId: created.id, eventId, seatId: seat.id })),
        });
        return created;
      });

      // 5. Only now are the seats really gone. Marking them sold drops the
      //    holds too, so every open seat map greys them out.
      await redis.eval(
        MARK_SOLD_LUA,
        2,
        keys.sold(eventId),
        keys.holds(eventId),
        eventId,
        String(seatIds.length),
        ...seatIds,
      );
      queueSeatUpdate(eventId, seatIds, 'sold');
      bumpStat(eventId, STAT.PURCHASES);
      bumpStat(eventId, STAT.TICKETS, seatIds.length);

      res.status(201).json({ orderId: order.id, total, seatIds });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // The unique index caught a double sell. The seat genuinely is gone, so
        // record that and tell this buyer honestly.
        await redis
          .eval(
            MARK_SOLD_LUA,
            2,
            keys.sold(eventId),
            keys.holds(eventId),
            eventId,
            String(seatIds.length),
            ...seatIds,
          )
          .catch(() => {});
        queueSeatUpdate(eventId, seatIds, 'sold');
        res.status(409).json({ error: 'One of those seats was just sold' });
        return;
      }
      throw err;
    }
  },
);

/**
 * The deliberately broken "before" build: read whether the seats are taken,
 * pause, then write. Two buyers both read "free" and both write, which is
 * exactly the double-sell the benchmarks measure.
 */
async function naiveCheckout(
  res: Response,
  args: {
    eventId: string;
    userId: string;
    seatIds: string[];
    seats: { id: string; price: number }[];
  },
) {
  const { eventId, userId, seatIds, seats } = args;

  const existing = await prisma.ticket.findMany({
    where: { eventId, seatId: { in: seatIds } },
  });
  if (existing.length > 0) {
    res.status(409).json({ error: 'One or more seats have already been sold' });
    return;
  }

  // The race window a real read-then-write checkout has anyway, made visible.
  await new Promise((resolve) => setTimeout(resolve, 20));

  const total = seats.reduce((acc, s) => acc + s.price, 0);
  const order = await prisma.order.create({ data: { userId, eventId, total } });

  const tickets = [];
  for (const seat of seats) {
    tickets.push(
      await prisma.ticket.create({ data: { orderId: order.id, eventId, seatId: seat.id } }),
    );
  }

  res.status(201).json({ orderId: order.id, total, tickets });
}

checkoutRouter.get('/api/orders/:orderId', requireAuth, async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const user = req.user!;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      event: true,
      tickets: { include: { seat: true } },
    },
  });

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  // Buyers can only see their own orders; admins can see all.
  if (order.userId !== user.id && user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  res.json({ order });
});
