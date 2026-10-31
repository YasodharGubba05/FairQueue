import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.MODE = 'fairqueue';
  process.env.RATE_LIMIT_ENABLED = 'false';
  delete process.env.TICKETMASTER_API_KEY;
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { EventSourceKind, EventStatus } from '@prisma/client';
import { app } from '../src/index';
import { prisma } from '../src/db';
import { redis } from '../src/redis';
import { keys, TTL } from '../src/keys';
import { signToken } from '../src/middleware/auth';
import { stopSeatUpdates } from '../src/seatUpdates';
import { defaultEndsAt, publicEventFilter, refusalFor } from '../src/events/lifecycle';
import { upsertSourcedEvent } from '../src/events/ingest';
// The worker owns retirement, so the test runs the worker's real sweep.
import { completeFinishedEvents } from '../../worker/src/lifecycle';

const PREFIX = 'evt_lifecycle_';
const HOUR = 60 * 60 * 1000;

const adminToken = signToken({ id: 'usr_lc_admin', email: 'lcadmin@test.dev', role: 'ADMIN' });
const buyerToken = signToken({ id: 'usr_lc_buyer', email: 'lcbuyer@test.dev', role: 'BUYER' });

describe('Phase P8 — event lifecycle', () => {
  let server: http.Server;
  let baseUrl: string;

  async function makeEvent(
    suffix: string,
    overrides: { status?: EventStatus; startsAt?: Date; endsAt?: Date; city?: string } = {},
  ) {
    const startsAt = overrides.startsAt ?? new Date(Date.now() + 24 * HOUR);
    return prisma.event.create({
      data: {
        id: `${PREFIX}${suffix}`,
        name: `Lifecycle ${suffix}`,
        venue: 'Lifecycle Arena',
        city: overrides.city ?? 'Testville',
        category: 'Lifecycle',
        startsAt,
        endsAt: overrides.endsAt ?? defaultEndsAt(startsAt),
        saleOpensAt: new Date(Date.now() - HOUR),
        status: overrides.status ?? EventStatus.LIVE,
        admitPerSec: 100,
        maxSeatsPerUser: 4,
      },
    });
  }

  async function wipe() {
    const ids = (
      await prisma.event.findMany({
        where: { id: { startsWith: PREFIX } },
        select: { id: true },
      })
    ).map((e) => e.id);
    if (ids.length === 0) return;
    await prisma.ticket.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.seat.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.event.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.createMany({
      data: [
        { id: 'usr_lc_admin', email: 'lcadmin@test.dev', passwordHash: 'x', role: 'ADMIN' },
        { id: 'usr_lc_buyer', email: 'lcbuyer@test.dev', passwordHash: 'x', role: 'BUYER' },
      ],
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
    await prisma.user.deleteMany({ where: { id: { in: ['usr_lc_admin', 'usr_lc_buyer'] } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    await redis.quit();
  });

  beforeEach(wipe);

  const listed = async (query = '') => {
    const res = await fetch(`${baseUrl}/api/events${query}`);
    const body = await res.json();
    return (body.events as { id: string }[]).map((e) => e.id);
  };

  describe('what the public can see', () => {
    it('lists an event that has not happened yet', async () => {
      await makeEvent('upcoming');
      expect(await listed()).toContain(`${PREFIX}upcoming`);
    });

    it('still lists an event that has started but not finished', async () => {
      // Dropping a show from the listing while people are walking in would be
      // wrong, so visibility keys on endsAt rather than startsAt.
      await makeEvent('ongoing', {
        startsAt: new Date(Date.now() - HOUR),
        endsAt: new Date(Date.now() + HOUR),
      });
      expect(await listed()).toContain(`${PREFIX}ongoing`);
    });

    it('hides an event once it is over', async () => {
      await makeEvent('finished', {
        startsAt: new Date(Date.now() - 5 * HOUR),
        endsAt: new Date(Date.now() - HOUR),
      });
      expect(await listed()).not.toContain(`${PREFIX}finished`);
    });

    it('hides a completed event even if its end time were somehow in the future', async () => {
      await makeEvent('completed', { status: EventStatus.COMPLETED });
      expect(await listed()).not.toContain(`${PREFIX}completed`);
    });

    it('hides a cancelled event', async () => {
      await makeEvent('cancelled', { status: EventStatus.CANCELLED });
      expect(await listed()).not.toContain(`${PREFIX}cancelled`);
    });

    it('hides them from search and from category and city filters too', async () => {
      await makeEvent('hidden', { status: EventStatus.CANCELLED, city: 'Hiddenton' });

      expect(await listed('?q=Lifecycle')).not.toContain(`${PREFIX}hidden`);
      expect(await listed('?category=Lifecycle')).not.toContain(`${PREFIX}hidden`);
      expect(await listed('?city=Hiddenton')).not.toContain(`${PREFIX}hidden`);

      // And its city does not sit in the filter row leading nowhere.
      const facets = (await (await fetch(`${baseUrl}/api/events`)).json()).facets;
      expect(facets.cities).not.toContain('Hiddenton');
    });
  });

  describe('what can still be bought', () => {
    it('refuses a queue join for a cancelled event', async () => {
      await makeEvent('nojoin', { status: EventStatus.CANCELLED });
      const res = await fetch(`${baseUrl}/api/events/${PREFIX}nojoin/queue/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
      });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain('cancelled');
    });

    it('refuses a hold for an event that has finished', async () => {
      await makeEvent('nohold', {
        startsAt: new Date(Date.now() - 5 * HOUR),
        endsAt: new Date(Date.now() - HOUR),
      });
      await redis.set(keys.pass(`${PREFIX}nohold`, 'usr_lc_buyer'), '1', 'EX', TTL.PASS_SECONDS);

      const res = await fetch(`${baseUrl}/api/events/${PREFIX}nohold/holds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` },
        body: JSON.stringify({ seatIds: ['anything'] }),
      });
      expect(res.status).toBe(409);
      await redis.del(keys.pass(`${PREFIX}nohold`, 'usr_lc_buyer'));
    });

    it('closes the gap between an event ending and the sweep noticing', () => {
      // The sweep runs on a timer, so for a few seconds an event can be over
      // without being marked. Every booking path reads endsAt directly as well.
      const justFinished = { status: EventStatus.LIVE, endsAt: new Date(Date.now() - 1000) };
      expect(refusalFor(justFinished)?.error).toContain('already taken place');
    });

    it('lets a live event through', () => {
      expect(refusalFor({ status: EventStatus.LIVE, endsAt: new Date(Date.now() + HOUR) })).toBeNull();
    });
  });

  describe('retiring events', () => {
    it('marks a finished event COMPLETED and leaves a running one alone', async () => {
      await makeEvent('over', {
        startsAt: new Date(Date.now() - 5 * HOUR),
        endsAt: new Date(Date.now() - HOUR),
      });
      await makeEvent('running', { endsAt: new Date(Date.now() + HOUR) });

      await completeFinishedEvents(prisma);

      expect((await prisma.event.findUniqueOrThrow({ where: { id: `${PREFIX}over` } })).status).toBe(
        EventStatus.COMPLETED,
      );
      expect(
        (await prisma.event.findUniqueOrThrow({ where: { id: `${PREFIX}running` } })).status,
      ).toBe(EventStatus.LIVE);
    });

    it('leaves a cancelled event cancelled rather than completing it', async () => {
      // It never happened, so it was never completed. The distinction matters
      // to whoever reads it later.
      await makeEvent('calledoff', {
        status: EventStatus.CANCELLED,
        startsAt: new Date(Date.now() - 5 * HOUR),
        endsAt: new Date(Date.now() - HOUR),
      });

      await completeFinishedEvents(prisma);

      expect(
        (await prisma.event.findUniqueOrThrow({ where: { id: `${PREFIX}calledoff` } })).status,
      ).toBe(EventStatus.CANCELLED);
    });

    it('keeps the orders and tickets of a completed event', async () => {
      const event = await makeEvent('withsales', {
        startsAt: new Date(Date.now() - 5 * HOUR),
        endsAt: new Date(Date.now() - HOUR),
      });
      const seat = await prisma.seat.create({
        data: {
          id: `s_${PREFIX}withsales_A1`,
          eventId: event.id,
          section: 'Floor',
          row: 'A',
          number: 1,
          price: 5000,
          x: 0,
          y: 0,
        },
      });
      const order = await prisma.order.create({
        data: { userId: 'usr_lc_buyer', eventId: event.id, total: seat.price },
      });
      await prisma.ticket.create({
        data: { orderId: order.id, eventId: event.id, seatId: seat.id },
      });

      await completeFinishedEvents(prisma);

      // The event has left the listings...
      expect(await listed()).not.toContain(event.id);
      // ...and the ticket is exactly where it was.
      expect(await prisma.ticket.count({ where: { eventId: event.id } })).toBe(1);

      // The buyer can still open their order.
      const res = await fetch(`${baseUrl}/api/orders/${order.id}`, {
        headers: { Authorization: `Bearer ${buyerToken}` },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).order.tickets).toHaveLength(1);
    });
  });

  describe('a sync must never bring an event back', () => {
    it('refreshes details without reopening a completed event', async () => {
      const event = await makeEvent('synced', { status: EventStatus.COMPLETED });
      await prisma.event.update({
        where: { id: event.id },
        data: { source: EventSourceKind.TICKETMASTER, externalId: 'lifecycle-ext-1' },
      });

      await upsertSourcedEvent(prisma, EventSourceKind.TICKETMASTER, {
        externalId: 'lifecycle-ext-1',
        name: 'Renamed By Sync',
        venue: 'Lifecycle Arena',
        city: 'Testville',
        country: 'GB',
        category: 'Lifecycle',
        startsAt: new Date(Date.now() + 48 * HOUR),
        sourceUrl: 'https://example.org/e/1',
        sourceName: 'Example',
      });

      const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(after.name).toBe('Renamed By Sync');
      // Still retired, and still out of the listings.
      expect(after.status).toBe(EventStatus.COMPLETED);
      expect(await listed()).not.toContain(event.id);
    });
  });

  describe('admin access', () => {
    it('shows an admin the events the public cannot see', async () => {
      await makeEvent('adminsees', { status: EventStatus.CANCELLED });

      const res = await fetch(`${baseUrl}/api/admin/events`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      const found = body.events.find((e: { id: string }) => e.id === `${PREFIX}adminsees`);
      expect(found).toBeDefined();
      expect(found.publiclyVisible).toBe(false);
    });

    it('refuses a buyer, whatever the frontend shows them', async () => {
      const res = await fetch(`${baseUrl}/api/admin/events`, {
        headers: { Authorization: `Bearer ${buyerToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('lets an admin cancel a live sale', async () => {
      await makeEvent('tocancel');
      const res = await fetch(`${baseUrl}/api/admin/events/${PREFIX}tocancel/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      expect(res.status).toBe(200);
      expect(await listed()).not.toContain(`${PREFIX}tocancel`);
    });

    it('refuses to reopen a cancelled event', async () => {
      await makeEvent('nocomeback', { status: EventStatus.CANCELLED });
      const res = await fetch(`${baseUrl}/api/admin/events/${PREFIX}nocomeback/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: 'LIVE' }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('the filter itself', () => {
    it('excludes terminal statuses and anything already ended', () => {
      const filter = publicEventFilter(new Date('2027-01-01T00:00:00Z'));
      expect(filter.status).toEqual({ notIn: [EventStatus.COMPLETED, EventStatus.CANCELLED] });
      expect(filter.endsAt).toEqual({ gt: new Date('2027-01-01T00:00:00Z') });
    });
  });
});
