import { Router, Request, Response } from 'express';
import { EventSourceKind, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { labelFor } from '../events/registry';

export const eventsRouter = Router();

/** What an event looks like to the frontend. */
function formatEvent(event: {
  id: string;
  name: string;
  venue: string;
  startsAt: Date;
  saleOpensAt: Date;
  status: string;
  admitPerSec: number;
  maxSeatsPerUser: number;
  source: EventSourceKind;
  category: string | null;
  city: string | null;
  country: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  verifiedAt: Date | null;
  lastSyncedAt: Date | null;
  seats: { price: number }[];
  tickets: { seatId: string }[];
}) {
  const totalSeats = event.seats.length;
  const soldSeats = event.tickets.length;

  let minPrice = 0;
  let maxPrice = 0;
  if (totalSeats > 0) {
    const prices = event.seats.map((s) => s.price);
    minPrice = Math.min(...prices);
    maxPrice = Math.max(...prices);
  }

  return {
    id: event.id,
    name: event.name,
    venue: event.venue,
    startsAt: event.startsAt,
    saleOpensAt: event.saleOpensAt,
    status: event.status,
    admitPerSec: event.admitPerSec,
    maxSeatsPerUser: event.maxSeatsPerUser,
    totalSeats,
    availableSeats: Math.max(0, totalSeats - soldSeats),
    minPrice,
    maxPrice,

    // Where the real-world details came from. The frontend uses this to say
    // plainly whether an event is a real one or an invented demo — and the
    // seats, prices and tickets below it are simulated either way.
    source: event.source,
    sourceLabel: labelFor(event.source),
    sourceName: event.sourceName,
    sourceUrl: event.sourceUrl,
    verified: event.source !== EventSourceKind.SEEDED,
    verifiedAt: event.verifiedAt,
    lastSyncedAt: event.lastSyncedAt,
    category: event.category,
    city: event.city,
    country: event.country,
  };
}

const INCLUDE = {
  seats: { select: { price: true } },
  tickets: { select: { seatId: true } },
} as const;

const querySchema = z.object({
  /** Free text across name, venue and city. */
  q: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  city: z.string().trim().min(1).max(60).optional(),
  source: z.nativeEnum(EventSourceKind).optional(),
});

eventsRouter.get('/api/events', async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid search or filter' });
    return;
  }
  const { q, category, city, source } = parsed.data;

  const where: Prisma.EventWhereInput = {
    ...(category ? { category: { equals: category, mode: 'insensitive' } } : {}),
    ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}),
    ...(source ? { source } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { venue: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const events = await prisma.event.findMany({
    where,
    orderBy: { startsAt: 'asc' },
    include: INCLUDE,
  });

  // Facets come from the whole catalogue, not the filtered result, so the
  // filter controls do not shrink as you use them and strand you with no way
  // back except clearing everything.
  const [categories, cities] = await Promise.all([
    prisma.event.findMany({
      where: { category: { not: null } },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    }),
    prisma.event.findMany({
      where: { city: { not: null } },
      distinct: ['city'],
      select: { city: true },
      orderBy: { city: 'asc' },
    }),
  ]);

  res.json({
    events: events.map(formatEvent),
    facets: {
      categories: categories.map((c) => c.category).filter((c): c is string => Boolean(c)),
      cities: cities.map((c) => c.city).filter((c): c is string => Boolean(c)),
    },
  });
});

eventsRouter.get('/api/events/:eventId', async (req: Request, res: Response) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.eventId },
    include: INCLUDE,
  });

  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  res.json({ event: formatEvent(event) });
});
