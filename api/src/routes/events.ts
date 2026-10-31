import { Router, Request, Response } from 'express';
import { prisma } from '../db';

export const eventsRouter = Router();

eventsRouter.get('/api/events', async (_req: Request, res: Response) => {
  const events = await prisma.event.findMany({
    orderBy: { startsAt: 'asc' },
    include: {
      seats: {
        select: {
          price: true,
        },
      },
      tickets: {
        select: {
          seatId: true,
        },
      },
    },
  });

  const formatted = events.map((event) => {
    const totalSeats = event.seats.length;
    const soldSeats = event.tickets.length;
    const availableSeats = Math.max(0, totalSeats - soldSeats);

    let minPrice = 0;
    let maxPrice = 0;
    if (totalSeats > 0) {
      minPrice = Math.min(...event.seats.map((s) => s.price));
      maxPrice = Math.max(...event.seats.map((s) => s.price));
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
      availableSeats,
      minPrice,
      maxPrice,
    };
  });

  res.json({ events: formatted });
});

eventsRouter.get('/api/events/:eventId', async (req: Request, res: Response) => {
  const { eventId } = req.params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      seats: {
        select: { price: true },
      },
      tickets: {
        select: { seatId: true },
      },
    },
  });

  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  const totalSeats = event.seats.length;
  const soldSeats = event.tickets.length;
  const availableSeats = Math.max(0, totalSeats - soldSeats);

  let minPrice = 0;
  let maxPrice = 0;
  if (totalSeats > 0) {
    minPrice = Math.min(...event.seats.map((s) => s.price));
    maxPrice = Math.max(...event.seats.map((s) => s.price));
  }

  res.json({
    event: {
      id: event.id,
      name: event.name,
      venue: event.venue,
      startsAt: event.startsAt,
      saleOpensAt: event.saleOpensAt,
      status: event.status,
      admitPerSec: event.admitPerSec,
      maxSeatsPerUser: event.maxSeatsPerUser,
      totalSeats,
      availableSeats,
      minPrice,
      maxPrice,
    },
  });
});
