import { Router, Request, Response } from 'express';
import { EventStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { isTerminal } from '../events/lifecycle';
import { labelFor } from '../events/registry';

export const adminRouter = Router();

/**
 * Admin access is checked on the server, on every admin route, by middleware
 * that is visible in the route definition. Hiding a link in the navigation is
 * not access control: the endpoint is what anyone can actually call.
 */
const adminOnly = [requireAuth, requireRole('ADMIN')];

/**
 * Every event, including the ones the public can no longer see.
 *
 * This is the counterpart to the visibility rule on the public listing: once
 * finished and cancelled events drop out of /api/events, an admin would
 * otherwise lose sight of exactly the events they most need to look at.
 */
adminRouter.get('/api/admin/events', adminOnly, async (_req: Request, res: Response) => {
  const events = await prisma.event.findMany({
    orderBy: { startsAt: 'desc' },
    include: {
      seats: { select: { price: true } },
      tickets: { select: { seatId: true } },
    },
  });

  res.json({
    events: events.map((event) => ({
      id: event.id,
      name: event.name,
      venue: event.venue,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: event.status,
      city: event.city,
      category: event.category,
      source: event.source,
      sourceLabel: labelFor(event.source),
      sourceName: event.sourceName,
      sourceUrl: event.sourceUrl,
      verified: event.source !== 'SEEDED',
      totalSeats: event.seats.length,
      ticketsSold: event.tickets.length,
      // Visible to a buyer right now, by the same rule the listing uses.
      publiclyVisible: !isTerminal(event.status) && event.endsAt.getTime() > Date.now(),
    })),
  });
});

const statusSchema = z.object({
  status: z.enum([EventStatus.LIVE, EventStatus.PAUSED, EventStatus.CANCELLED]),
});

/**
 * Pause, resume or cancel a sale.
 *
 * Pausing does not close the queue — it stops the worker admitting anyone,
 * while people keep joining and keep their places. Holding a sale must never
 * cost a buyer the position they have already waited for.
 *
 * Cancelling is final. A cancelled event cannot be brought back, because
 * "cancelled then uncancelled" is not a state a ticketing site should be able
 * to get into: anyone who was told the show was off has already acted on it.
 */
adminRouter.post(
  '/api/admin/events/:eventId/status',
  adminOnly,
  async (req: Request, res: Response) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'status must be LIVE, PAUSED or CANCELLED' });
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: req.params.eventId },
      select: { id: true, status: true },
    });
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    if (isTerminal(event.status)) {
      res.status(409).json({
        error:
          event.status === EventStatus.CANCELLED
            ? 'This event has been cancelled and cannot be reopened'
            : 'This event has already taken place',
      });
      return;
    }

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { status: parsed.data.status },
      select: { id: true, status: true },
    });

    res.json({ event: updated });
  },
);
