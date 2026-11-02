import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.MODE = 'fairqueue';
  process.env.RATE_LIMIT_ENABLED = 'false';
  delete process.env.TICKETMASTER_API_KEY;
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { EventStatus, NotificationKind } from '@prisma/client';
import { app } from '../src/index';
import { prisma } from '../src/db';
import { redis } from '../src/redis';
import { keys } from '../src/keys';
import { signAccessToken } from '../src/auth/tokens';
import { stopSeatUpdates } from '../src/seatUpdates';
import { defaultEndsAt } from '../src/events/lifecycle';
// The worker owns the radar, so the tests run the worker's real code.
import {
  announceOpeningSoon, announceReturnedInventory, forgetAvailability, openDueSales,
} from '../../worker/src/radar';

const PREFIX = 'evt_radar_';
const ALICE = 'usr_radar_alice';
const BOB = 'usr_radar_bob';
const HOUR = 60 * 60 * 1000;
const token = (id: string) => signAccessToken({ id, email: `${id}@radar.test`, role: 'BUYER' });

describe('Phase P10 — smart event radar', () => {
  let server: http.Server;
  let baseUrl: string;

  async function makeEvent(
    suffix: string,
    overrides: { status?: EventStatus; saleOpensAt?: Date; seats?: number } = {},
  ) {
    const startsAt = new Date(Date.now() + 72 * HOUR);
    const event = await prisma.event.create({
      data: {
        id: `${PREFIX}${suffix}`,
        name: `Radar ${suffix}`,
        venue: 'Radar Arena',
        city: 'Testville',
        startsAt,
        endsAt: defaultEndsAt(startsAt),
        saleOpensAt: overrides.saleOpensAt ?? new Date(Date.now() + 48 * HOUR),
        status: overrides.status ?? EventStatus.UPCOMING,
        admitPerSec: 100,
        maxSeatsPerUser: 4,
      },
    });

    if (overrides.seats) {
      await prisma.seat.createMany({
        data: Array.from({ length: overrides.seats }, (_, i) => ({
          id: `s_${event.id}_${i + 1}`,
          eventId: event.id,
          section: 'Floor',
          row: 'A',
          number: i + 1,
          price: 5000,
          x: i * 12,
          y: 0,
        })),
      });
    }
    return event;
  }

  async function wipe() {
    const ids = (
      await prisma.event.findMany({
        where: { id: { startsWith: PREFIX } },
        select: { id: true },
      })
    ).map((e) => e.id);

    await prisma.notification.deleteMany({ where: { userId: { in: [ALICE, BOB] } } });
    if (ids.length > 0) {
      await prisma.eventFollow.deleteMany({ where: { eventId: { in: ids } } });
      await prisma.seat.deleteMany({ where: { eventId: { in: ids } } });
      await prisma.event.deleteMany({ where: { id: { in: ids } } });
      for (const id of ids) {
        const announced = await redis.keys(`radar:announced:*:${id}`);
        if (announced.length > 0) await redis.del(...announced);
        await redis.del(keys.sold(id), keys.holds(id));
      }
    }
    forgetAvailability();
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [ALICE, BOB].map((id) => ({
        id,
        email: `${id}@radar.test`,
        passwordHash: 'x',
        emailVerified: true,
      })),
      skipDuplicates: true,
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    stopSeatUpdates();
    await wipe();
    await prisma.user.deleteMany({ where: { id: { in: [ALICE, BOB] } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    await redis.quit();
  });

  beforeEach(wipe);

  const follow = (userId: string, eventId: string, body: unknown = {}) =>
    fetch(`${baseUrl}/api/events/${eventId}/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(userId)}` },
      body: JSON.stringify(body),
    });

  const unfollow = (userId: string, eventId: string) =>
    fetch(`${baseUrl}/api/events/${eventId}/follow`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token(userId)}` },
    });

  const notifications = (userId: string) =>
    fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${token(userId)}` },
    }).then((r) => r.json());

  describe('following', () => {
    it('follows an event and reports it on the listing', async () => {
      const event = await makeEvent('follow');
      expect((await follow(ALICE, event.id)).status).toBe(200);

      const follows = await (
        await fetch(`${baseUrl}/api/follows`, {
          headers: { Authorization: `Bearer ${token(ALICE)}` },
        })
      ).json();
      expect(follows.follows.map((f: { eventId: string }) => f.eventId)).toContain(event.id);
    });

    it('is idempotent, so a double tap is harmless', async () => {
      const event = await makeEvent('twice');
      await follow(ALICE, event.id);
      await follow(ALICE, event.id);

      expect(
        await prisma.eventFollow.count({ where: { userId: ALICE, eventId: event.id } }),
      ).toBe(1);
    });

    it('unfollowing something you do not follow is not an error', async () => {
      const event = await makeEvent('never');
      expect((await unfollow(ALICE, event.id)).status).toBe(200);
    });

    it('refuses to follow a cancelled event', async () => {
      // Following something that will never happen only disappoints.
      const event = await makeEvent('cancelled', { status: EventStatus.CANCELLED });
      expect((await follow(ALICE, event.id)).status).toBe(404);
    });

    it('needs a signed-in user', async () => {
      const event = await makeEvent('anon');
      const res = await fetch(`${baseUrl}/api/events/${event.id}/follow`, { method: 'POST' });
      expect(res.status).toBe(401);
    });
  });

  describe('opening sales', () => {
    it('opens a sale whose time has come and leaves a future one alone', async () => {
      const due = await makeEvent('due', { saleOpensAt: new Date(Date.now() - 1000) });
      const later = await makeEvent('later', { saleOpensAt: new Date(Date.now() + 48 * HOUR) });

      const opened = await openDueSales(prisma, redis as never);

      expect(opened).toContain(due.id);
      expect(opened).not.toContain(later.id);
      expect((await prisma.event.findUniqueOrThrow({ where: { id: due.id } })).status).toBe(
        EventStatus.LIVE,
      );
      expect((await prisma.event.findUniqueOrThrow({ where: { id: later.id } })).status).toBe(
        EventStatus.UPCOMING,
      );
    });

    it('does not reopen an event that has already finished', async () => {
      const over = await prisma.event.create({
        data: {
          id: `${PREFIX}over`,
          name: 'Radar over',
          venue: 'Radar Arena',
          startsAt: new Date(Date.now() - 5 * HOUR),
          endsAt: new Date(Date.now() - HOUR),
          saleOpensAt: new Date(Date.now() - 10 * HOUR),
          status: EventStatus.UPCOMING,
        },
      });

      expect(await openDueSales(prisma, redis as never)).not.toContain(over.id);
      expect((await prisma.event.findUniqueOrThrow({ where: { id: over.id } })).status).toBe(
        EventStatus.UPCOMING,
      );
    });

    it('notifies followers once, however many times the worker ticks', async () => {
      // A follower told four times a second that a sale opened would unfollow
      // immediately. The Redis guard is what stops that.
      const event = await makeEvent('notify', { saleOpensAt: new Date(Date.now() - 1000) });
      await follow(ALICE, event.id);
      await follow(BOB, event.id);

      await openDueSales(prisma, redis as never);
      await openDueSales(prisma, redis as never);
      await openDueSales(prisma, redis as never);

      const sent = await prisma.notification.count({
        where: { eventId: event.id, kind: NotificationKind.SALE_OPENED },
      });
      expect(sent).toBe(2);
    });

    it('tells nobody when nobody is following', async () => {
      const event = await makeEvent('lonely', { saleOpensAt: new Date(Date.now() - 1000) });
      await openDueSales(prisma, redis as never);
      expect(await prisma.notification.count({ where: { eventId: event.id } })).toBe(0);
    });
  });

  describe('opening soon', () => {
    it('nudges followers shortly before a sale opens', async () => {
      const event = await makeEvent('soon', { saleOpensAt: new Date(Date.now() + 5 * 60_000) });
      await follow(ALICE, event.id);

      expect(await announceOpeningSoon(prisma, redis as never)).toBe(1);
      // And only once.
      expect(await announceOpeningSoon(prisma, redis as never)).toBe(0);
    });

    it('skips a follower who turned the reminder off', async () => {
      const event = await makeEvent('quiet', { saleOpensAt: new Date(Date.now() + 5 * 60_000) });
      await follow(ALICE, event.id, { remindBeforeOpen: false });

      expect(await announceOpeningSoon(prisma, redis as never)).toBe(0);
    });
  });

  describe('inventory coming back', () => {
    const withSeats = (id: string, seats: number) => ({ id, _count: { seats } });

    it('says nothing on the first reading', async () => {
      // One sample is not a transition, and inventing one would be making a
      // number up.
      const event = await makeEvent('first', { status: EventStatus.LIVE, seats: 2 });
      await follow(ALICE, event.id);

      expect(
        await announceReturnedInventory(prisma, redis as never, withSeats(event.id, 2)),
      ).toBe(false);
    });

    it('announces when a sold-out event gets a seat back', async () => {
      const event = await makeEvent('returned', { status: EventStatus.LIVE, seats: 2 });
      await follow(ALICE, event.id);

      // Nothing left.
      await redis.sadd(keys.sold(event.id), `s_${event.id}_1`, `s_${event.id}_2`);
      await announceReturnedInventory(prisma, redis as never, withSeats(event.id, 2));

      // A seat comes back.
      await redis.srem(keys.sold(event.id), `s_${event.id}_2`);
      expect(
        await announceReturnedInventory(prisma, redis as never, withSeats(event.id, 2)),
      ).toBe(true);

      const sent = await prisma.notification.findMany({ where: { eventId: event.id } });
      expect(sent).toHaveLength(1);
      expect(sent[0].kind).toBe(NotificationKind.INVENTORY_RETURNED);
    });

    it('says nothing when seats were available all along', async () => {
      // A hold lapsing on an event with plenty free is not news.
      const event = await makeEvent('plenty', { status: EventStatus.LIVE, seats: 10 });
      await follow(ALICE, event.id);

      await announceReturnedInventory(prisma, redis as never, withSeats(event.id, 10));
      await redis.sadd(keys.sold(event.id), `s_${event.id}_1`);

      expect(
        await announceReturnedInventory(prisma, redis as never, withSeats(event.id, 10)),
      ).toBe(false);
    });
  });

  describe('reading notifications', () => {
    it('lists them unread first and counts the unread', async () => {
      const event = await makeEvent('read', { saleOpensAt: new Date(Date.now() - 1000) });
      await follow(ALICE, event.id);
      await openDueSales(prisma, redis as never);

      const before = await notifications(ALICE);
      expect(before.unread).toBe(1);
      expect(before.notifications[0].readAt).toBeNull();

      const marked = await fetch(`${baseUrl}/api/notifications/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(ALICE)}` },
        body: JSON.stringify({}),
      });
      expect((await marked.json()).read).toBe(1);
      expect((await notifications(ALICE)).unread).toBe(0);
    });

    it('cannot mark somebody else’s notifications read', async () => {
      const event = await makeEvent('mine', { saleOpensAt: new Date(Date.now() - 1000) });
      await follow(BOB, event.id);
      await openDueSales(prisma, redis as never);

      const bobsIds = (await notifications(BOB)).notifications.map((n: { id: string }) => n.id);

      const res = await fetch(`${baseUrl}/api/notifications/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(ALICE)}` },
        body: JSON.stringify({ ids: bobsIds }),
      });
      // Scoped to the caller, so Alice marks nothing.
      expect((await res.json()).read).toBe(0);
      expect((await notifications(BOB)).unread).toBe(1);
    });

    it('shows one person nothing of another’s', async () => {
      const event = await makeEvent('private', { saleOpensAt: new Date(Date.now() - 1000) });
      await follow(BOB, event.id);
      await openDueSales(prisma, redis as never);

      expect((await notifications(ALICE)).notifications).toHaveLength(0);
    });
  });
});
