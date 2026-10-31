import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { redis } from '../redis';
import { keys } from '../keys';
import { requireAuth } from '../middleware/auth';
import { JOIN_QUEUE_LUA } from '../lua/queue';
import { rateLimit } from '../middleware/rateLimit';
import { refusalFor } from '../events/lifecycle';

// Joining is idempotent, so repeat calls are harmless — this is only here to
// stop one account spinning on the endpoint.
const joinLimit = rateLimit('join', { perUser: 10 });

export const queueRouter = Router();

/** What both queue endpoints return, so the client has one shape to read. */
type QueueState = {
  joinNumber: number | null;
  joined: number;
  admitted: number;
  ahead: number;
  hasPass: boolean;
  passExpiresInSec: number | null;
  admitPerSec: number;
  status: string;
  maxSeatsPerUser: number;
};

async function loadEvent(eventId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, status: true, endsAt: true, admitPerSec: true, maxSeatsPerUser: true },
  });
}

async function readState(
  eventId: string,
  userId: string,
  event: { status: string; admitPerSec: number; maxSeatsPerUser: number },
  joinNumberOverride?: number,
): Promise<QueueState> {
  const [memberRaw, joinedRaw, admittedRaw, passTtl] = await Promise.all([
    joinNumberOverride === undefined
      ? redis.get(keys.queueMember(eventId, userId))
      : Promise.resolve(String(joinNumberOverride)),
    redis.get(keys.queueNext(eventId)),
    redis.get(keys.admitted(eventId)),
    redis.ttl(keys.pass(eventId, userId)),
  ]);

  const joinNumber = memberRaw === null ? null : Number(memberRaw);
  const joined = Number(joinedRaw ?? 0);
  const admitted = Number(admittedRaw ?? 0);

  return {
    joinNumber,
    joined,
    admitted,
    ahead: joinNumber === null ? 0 : Math.max(0, joinNumber - admitted),
    // ttl returns -2 when the key is gone and -1 when it has no expiry.
    hasPass: passTtl > 0,
    passExpiresInSec: passTtl > 0 ? passTtl : null,
    admitPerSec: event.admitPerSec,
    status: event.status,
    maxSeatsPerUser: event.maxSeatsPerUser,
  };
}

// Take a place in line. Calling it again returns the same number, so a refresh
// or a dropped connection never costs you your place.
queueRouter.post('/api/events/:eventId/queue/join', requireAuth, joinLimit, async (req: Request, res: Response) => {
  const { eventId } = req.params;
  const user = req.user!;

  const event = await loadEvent(eventId);
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  // One rule for every booking path, so a cancelled or finished event cannot
  // be queued for, held in, or bought from.
  const refusal = refusalFor(event);
  if (refusal) {
    res.status(refusal.status).json({ error: refusal.error });
    return;
  }

  const joinNumber = (await redis.eval(
    JOIN_QUEUE_LUA,
    3,
    keys.queueMember(eventId, user.id),
    keys.queueNext(eventId),
    keys.queue(eventId),
    user.id,
  )) as number;

  res.status(200).json(await readState(eventId, user.id, event, joinNumber));
});

// Where am I? The browser calls this once on load and then follows the
// per-second broadcast instead of polling.
queueRouter.get('/api/events/:eventId/queue', requireAuth, async (req: Request, res: Response) => {
  const { eventId } = req.params;
  const user = req.user!;

  const event = await loadEvent(eventId);
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  res.json(await readState(eventId, user.id, event));
});
