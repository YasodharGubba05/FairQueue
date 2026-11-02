import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { labelFor } from '../events/registry';
import { publicEventFilter } from '../events/lifecycle';

export const radarRouter = Router();

const followLimit = rateLimit('follow', { perUser: 40 });

/** Just enough of an event to render a notification or a follow row. */
const EVENT_SELECT = {
  id: true, name: true, venue: true, city: true, startsAt: true, endsAt: true,
  saleOpensAt: true, status: true, source: true, sourceUrl: true, sourceName: true,
} as const;

function formatEvent(event: {
  id: string; name: string; venue: string; city: string | null;
  startsAt: Date; endsAt: Date; saleOpensAt: Date; status: string;
  source: string; sourceUrl: string | null; sourceName: string | null;
}) {
  return {
    id: event.id,
    name: event.name,
    venue: event.venue,
    city: event.city,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    saleOpensAt: event.saleOpensAt,
    status: event.status,
    verified: event.source !== 'SEEDED',
    sourceLabel: labelFor(event.source as never),
    sourceName: event.sourceName,
    sourceUrl: event.sourceUrl,
  };
}

const followSchema = z.object({
  remindBeforeOpen: z.boolean().optional(),
});

/**
 * Follow an event.
 *
 * An upsert rather than a create: following something twice is not an error a
 * person should ever see, and the unique constraint means the database would
 * reject the second one anyway. This makes the endpoint idempotent, so a
 * double-tapped button does the right thing.
 */
radarRouter.post(
  '/api/events/:eventId/follow',
  requireAuth,
  followLimit,
  async (req: Request, res: Response) => {
    const user = req.user!;
    const { eventId } = req.params;

    const parsed = followSchema.safeParse(req.body ?? {});
    const remindBeforeOpen = parsed.success ? parsed.data.remindBeforeOpen ?? true : true;

    // Only events a buyer can actually see. Following something that has been
    // cancelled or has already happened would only ever disappoint.
    const event = await prisma.event.findFirst({
      where: { id: eventId, ...publicEventFilter() },
      select: EVENT_SELECT,
    });
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    const follow = await prisma.eventFollow.upsert({
      where: { userId_eventId: { userId: user.id, eventId } },
      update: { remindBeforeOpen },
      create: { userId: user.id, eventId, remindBeforeOpen },
      select: { createdAt: true, remindBeforeOpen: true },
    });

    res.json({ following: true, event: formatEvent(event), ...follow });
  },
);

radarRouter.delete(
  '/api/events/:eventId/follow',
  requireAuth,
  followLimit,
  async (req: Request, res: Response) => {
    const user = req.user!;
    // deleteMany rather than delete: unfollowing something you were not
    // following is not an error either.
    await prisma.eventFollow.deleteMany({
      where: { userId: user.id, eventId: req.params.eventId },
    });
    res.json({ following: false });
  },
);

/** Everything this person is watching. */
radarRouter.get('/api/follows', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;

  const follows = await prisma.eventFollow.findMany({
    where: { userId: user.id, event: publicEventFilter() },
    include: { event: { select: EVENT_SELECT } },
    orderBy: { event: { saleOpensAt: 'asc' } },
  });

  res.json({
    follows: follows.map((f) => ({
      eventId: f.eventId,
      followedAt: f.createdAt,
      remindBeforeOpen: f.remindBeforeOpen,
      event: formatEvent(f.event),
    })),
  });
});

/**
 * What this person has been told.
 *
 * Unread first, because the unread ones are the reason anybody opens this.
 */
radarRouter.get('/api/notifications', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;

  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      include: { event: { select: EVENT_SELECT } },
      orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 50,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  res.json({
    unread,
    notifications: notifications.map((n) => ({
      id: n.id,
      kind: n.kind,
      createdAt: n.createdAt,
      readAt: n.readAt,
      event: formatEvent(n.event),
    })),
  });
});

const readSchema = z.object({
  ids: z.array(z.string().min(1)).max(100).optional(),
});

/** Mark some or all of them read. */
radarRouter.post('/api/notifications/read', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;

  const parsed = readSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'ids must be an array of notification ids' });
    return;
  }

  const { count } = await prisma.notification.updateMany({
    // Scoped to this user, so passing somebody else's ids marks nothing.
    where: {
      userId: user.id,
      readAt: null,
      ...(parsed.data.ids ? { id: { in: parsed.data.ids } } : {}),
    },
    data: { readAt: new Date() },
  });

  res.json({ read: count });
});
