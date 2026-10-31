import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { redis } from '../redis';
import { keys, TTL } from '../keys';
import { requireAuth } from '../middleware/auth';
import { HOLD_SEATS_LUA, RELEASE_SEATS_LUA } from '../lua/hold';
import { queueSeatUpdate } from '../seatUpdates';
import { rateLimit } from '../middleware/rateLimit';
import { bumpStat, STAT } from '../stats';
import { isNaive } from '../env';

// A buyer picking four seats makes a handful of calls; anything past this is
// not a person choosing where to sit.
const holdLimit = rateLimit('hold', { perUser: 30 });

export const holdsRouter = Router();

const seatsSchema = z.object({
  seatIds: z.array(z.string().min(1)).min(1).max(20),
});

/** Why a hold was refused, in words a buyer can act on. */
const REFUSALS: Record<string, { status: number; message: (detail: string) => string }> = {
  NO_PASS: {
    status: 403,
    message: () => 'You need to go through the queue before choosing seats',
  },
  SOLD: { status: 409, message: () => 'One of those seats was just sold' },
  HELD: { status: 409, message: () => 'Someone else is holding one of those seats' },
  MAX_SEATS: {
    status: 409,
    message: (max) => `You can hold at most ${max} seats for this event`,
  },
};

holdsRouter.post(
  '/api/events/:eventId/holds',
  requireAuth,
  holdLimit,
  async (req: Request, res: Response) => {
    const { eventId } = req.params;
    const user = req.user!;

    if (isNaive) {
      res.status(409).json({ error: 'Seat holds do not exist in naive mode' });
      return;
    }

    const parsed = seatsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'seatIds must be an array of 1 to 20 seat ids' });
      return;
    }
    const { seatIds } = parsed.data;
    // Asking for the same seat twice would make the cap count it twice.
    const unique = [...new Set(seatIds)];

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, maxSeatsPerUser: true },
    });
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    const expiresAt = Date.now() + TTL.HOLD_SECONDS * 1000;

    const [outcome, detail] = (await redis.eval(
      HOLD_SEATS_LUA,
      4,
      keys.sold(eventId),
      keys.userSeats(eventId, user.id),
      keys.pass(eventId, user.id),
      keys.holds(eventId),
      eventId,
      user.id,
      String(event.maxSeatsPerUser),
      String(TTL.HOLD_SECONDS),
      String(TTL.HOLD_GRACE_SECONDS),
      String(expiresAt),
      String(TTL.USER_SEATS_SECONDS),
      String(unique.length),
      ...unique,
    )) as [string, string];

    if (outcome !== 'OK') {
      // No pass means somebody called this endpoint without going through the
      // line. Worth counting on its own: it is the shape a bot makes.
      if (outcome === 'NO_PASS') bumpStat(eventId, STAT.NO_PASS);

      const refusal = REFUSALS[outcome];
      res
        .status(refusal?.status ?? 409)
        .json({ error: refusal?.message(detail) ?? 'Could not hold those seats', seatId: detail });
      return;
    }

    bumpStat(eventId, STAT.HOLDS, unique.length);
    queueSeatUpdate(eventId, unique, 'held');

    res.status(201).json({
      seatIds: unique,
      expiresAt,
      holdSeconds: TTL.HOLD_SECONDS,
    });
  },
);

// Giving seats back when a buyer changes their mind, so the next person can
// have them straight away instead of waiting out the five minute hold.
holdsRouter.delete(
  '/api/events/:eventId/holds',
  requireAuth,
  holdLimit,
  async (req: Request, res: Response) => {
    const { eventId } = req.params;
    const user = req.user!;

    const parsed = seatsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'seatIds must be an array of 1 to 20 seat ids' });
      return;
    }
    const unique = [...new Set(parsed.data.seatIds)];

    const released = (await redis.eval(
      RELEASE_SEATS_LUA,
      2,
      keys.userSeats(eventId, user.id),
      keys.holds(eventId),
      eventId,
      user.id,
      String(unique.length),
      ...unique,
    )) as string[];

    if (released.length > 0) queueSeatUpdate(eventId, released, 'available');

    res.json({ released });
  },
);

// What this user is holding right now, so a reloaded seat map or checkout page
// can put the selection and its countdown back exactly as it was.
holdsRouter.get(
  '/api/events/:eventId/holds',
  requireAuth,
  async (req: Request, res: Response) => {
    const { eventId } = req.params;
    const user = req.user!;

    const seatIds = await redis.smembers(keys.userSeats(eventId, user.id));
    if (seatIds.length === 0) {
      res.json({ seatIds: [], expiresAt: null });
      return;
    }

    // The soonest expiry is the one the countdown has to show.
    const scores = await Promise.all(
      seatIds.map((id) => redis.zscore(keys.holds(eventId), id)),
    );
    const live = seatIds.filter((_, i) => scores[i] !== null);
    const expiries = scores.filter((s): s is string => s !== null).map(Number);

    res.json({
      seatIds: live,
      expiresAt: expiries.length > 0 ? Math.min(...expiries) : null,
    });
  },
);
