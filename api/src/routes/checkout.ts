import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { isNaive } from '../env';

export const checkoutRouter = Router();

const checkoutSchema = z.object({
  seatIds: z.array(z.string().min(1)).min(1),
});

checkoutRouter.post('/api/events/:eventId/checkout', requireAuth, async (req: Request, res: Response) => {
  const { eventId } = req.params;
  const user = req.user!;

  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'seatIds must be a non-empty array of seat IDs' });
    return;
  }

  const { seatIds } = parsed.data;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  if (seatIds.length > event.maxSeatsPerUser) {
    res.status(400).json({ error: `Cannot purchase more than ${event.maxSeatsPerUser} seats` });
    return;
  }

  const seats = await prisma.seat.findMany({
    where: {
      eventId,
      id: { in: seatIds },
    },
  });

  if (seats.length !== seatIds.length) {
    res.status(400).json({ error: 'One or more invalid seats selected' });
    return;
  }

  if (isNaive) {
    // NAIVE MODE: Deliberately broken "before" implementation.
    // No queue check, no admission pass, no distributed lock.
    // 1. Read: check if seats are already taken in the database.
    const existing = await prisma.ticket.findMany({
      where: {
        eventId,
        seatId: { in: seatIds },
      },
    });

    if (existing.length > 0) {
      res.status(409).json({ error: 'One or more seats have already been sold' });
      return;
    }

    // 2. Artificial race gap (simulates payment processing delay where concurrency races).
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 3. Write: create order and insert tickets without atomic locks or transactions.
    const total = seats.reduce((acc, s) => acc + s.price, 0);

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        eventId,
        total,
      },
    });

    const tickets = [];
    for (const seat of seats) {
      const ticket = await prisma.ticket.create({
        data: {
          orderId: order.id,
          eventId,
          seatId: seat.id,
        },
      });
      tickets.push(ticket);
    }

    res.status(201).json({
      orderId: order.id,
      total,
      tickets,
    });
    return;
  }

  // FairQueue mode checkout will be implemented in P3 with Lua hold validation & DB transaction.
  res.status(501).json({ error: 'FairQueue mode checkout is implemented in P3' });
});

checkoutRouter.get('/api/orders/:orderId', requireAuth, async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const user = req.user!;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      event: true,
      tickets: {
        include: {
          seat: true,
        },
      },
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
