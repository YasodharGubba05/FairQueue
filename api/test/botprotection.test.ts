import { vi } from 'vitest';

// Vitest sets process.env.MODE to 'test', and this suite needs the fairqueue build.
// vi.hoisted runs before the imports below, so src/env.ts reads the right mode.
vi.hoisted(() => {
  process.env.MODE = 'fairqueue';
  // A small, predictable multiplier, so the per-address limit can be tested
  // rather than being so loose nothing ever reaches it.
  process.env.RATE_LIMIT_IP_FACTOR = '2';
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { app } from '../src/index';
import { prisma } from '../src/db';
import { redis } from '../src/redis';
import { keys, TTL } from '../src/keys';
import { signToken } from '../src/middleware/auth';
import { STAT } from '../src/stats';
import { readEventStats } from '../src/routes/stats';
import { stopSeatUpdates } from '../src/seatUpdates';

const EVENT_ID = 'evt_test_bots';
const SEAT_COUNT = 12;
const seatId = (n: number) => `s_test_bots_${n}`;

function token(userId: string) {
  return signToken({ id: userId, email: `${userId}@test.dev`, role: 'BUYER' });
}

describe('Phase P4 — bot protection, rate limits and stats', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await prisma.event.upsert({
      where: { id: EVENT_ID },
      update: { status: 'LIVE' },
      create: {
        id: EVENT_ID,
        name: 'Bot Test Event',
        venue: 'Test Arena',
        startsAt: new Date(Date.now() + 86_400_000),
        saleOpensAt: new Date(Date.now() - 1000),
        status: 'LIVE',
        admitPerSec: 100,
        maxSeatsPerUser: 4,
      },
    });

    await prisma.seat.createMany({
      data: Array.from({ length: SEAT_COUNT }, (_, i) => ({
        id: seatId(i),
        eventId: EVENT_ID,
        section: 'Floor',
        row: 'A',
        number: i + 1,
        price: 5000,
        x: i * 12,
        y: 0,
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
    await clearRedis();
    await prisma.seat.deleteMany({ where: { eventId: EVENT_ID } });
    await prisma.event.delete({ where: { id: EVENT_ID } }).catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    await redis.quit();
  });

  async function clearRedis() {
    for (const pattern of [
      `rate:*`,
      `pass:${EVENT_ID}:*`,
      `userseats:${EVENT_ID}:*`,
      `hold:${EVENT_ID}:*`,
      `stats:${EVENT_ID}:*`,
      `queue:*${EVENT_ID}*`,
    ]) {
      const found = await redis.keys(pattern);
      if (found.length > 0) await redis.del(...found);
    }
    await redis.del(
      keys.holds(EVENT_ID),
      keys.sold(EVENT_ID),
      keys.queue(EVENT_ID),
      keys.queueNext(EVENT_ID),
      keys.admitted(EVENT_ID),
    );
  }

  beforeEach(clearRedis);

  const hold = (userId: string, seats: string[]) =>
    fetch(`${baseUrl}/api/events/${EVENT_ID}/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(userId)}` },
      body: JSON.stringify({ seatIds: seats }),
    });

  const checkout = (userId: string, seats: string[]) =>
    fetch(`${baseUrl}/api/events/${EVENT_ID}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(userId)}` },
      body: JSON.stringify({ seatIds: seats }),
    });

  describe('the queue is the gate', () => {
    it('refuses a hold with no admission pass', async () => {
      const res = await hold('bot_1', [seatId(0)]);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain('queue');
    });

    it('refuses a checkout aimed straight at the endpoint', async () => {
      // A bot that skips the seat map entirely and posts to checkout.
      const res = await checkout('bot_2', [seatId(1)]);
      expect(res.status).toBe(403);
      expect(await prisma.ticket.count({ where: { eventId: EVENT_ID } })).toBe(0);
    });

    it('counts queue-skipping attempts separately from ordinary refusals', async () => {
      await hold('bot_3', [seatId(2)]);
      await checkout('bot_3', [seatId(2)]);

      expect(Number(await redis.get(keys.stat(EVENT_ID, STAT.NO_PASS)))).toBe(2);
    });

    it('lets the same request through once the user has been admitted', async () => {
      await redis.set(keys.pass(EVENT_ID, 'real_buyer'), '1', 'EX', TTL.PASS_SECONDS);
      const res = await hold('real_buyer', [seatId(3)]);
      expect(res.status).toBe(201);
    });
  });

  describe('rate limits', () => {
    it('turns away an account hammering the hold endpoint', async () => {
      await redis.set(keys.pass(EVENT_ID, 'spammer'), '1', 'EX', TTL.PASS_SECONDS);

      // The per-account limit on holds is 30 in a 10 second window.
      const responses = [];
      for (let i = 0; i < 40; i++) responses.push(await hold('spammer', [seatId(i % SEAT_COUNT)]));

      const blocked = responses.filter((r) => r.status === 429);
      expect(blocked.length).toBeGreaterThan(0);
      expect(responses.slice(0, 30).every((r) => r.status !== 429)).toBe(true);
      // And it tells the caller when to come back rather than just failing.
      expect(blocked[0].headers.get('retry-after')).toBe('10');
    });

    it('counts blocked requests for the dashboard', async () => {
      await redis.set(keys.pass(EVENT_ID, 'spammer2'), '1', 'EX', TTL.PASS_SECONDS);
      for (let i = 0; i < 40; i++) await hold('spammer2', [seatId(i % SEAT_COUNT)]);

      expect(Number(await redis.get(keys.stat(EVENT_ID, STAT.BLOCKED)))).toBeGreaterThan(0);
    });

    it('keeps one account hitting its limit from blocking another', async () => {
      await redis.set(keys.pass(EVENT_ID, 'loud'), '1', 'EX', TTL.PASS_SECONDS);
      await redis.set(keys.pass(EVENT_ID, 'quiet'), '1', 'EX', TTL.PASS_SECONDS);

      // "loud" spends its own allowance, and some of the shared address one.
      for (let i = 0; i < 31; i++) await hold('loud', [seatId(i % SEAT_COUNT)]);

      // "quiet" has made one request in its life and must still be served.
      const res = await hold('quiet', [seatId(5)]);
      expect(res.status).not.toBe(429);
    });

    it('expires the window so a blocked account recovers on its own', async () => {
      await redis.set(keys.pass(EVENT_ID, 'recovers'), '1', 'EX', TTL.PASS_SECONDS);
      for (let i = 0; i < 40; i++) await hold('recovers', [seatId(i % SEAT_COUNT)]);

      // The counter carries its window, so it has to expire by itself.
      const counters = await redis.keys('rate:user:recovers:*');
      expect(counters.length).toBeGreaterThan(0);
      for (const key of counters) {
        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('Mission Control stats', () => {
    it('reports the queue, the seats and a zero oversold count', async () => {
      await redis.set(keys.queueNext(EVENT_ID), '120');
      await redis.set(keys.admitted(EVENT_ID), '45');
      await redis.set(keys.pass(EVENT_ID, 'shopper'), '1', 'EX', TTL.PASS_SECONDS);
      await hold('shopper', [seatId(6), seatId(7)]);

      const stats = await readEventStats(EVENT_ID);

      expect(stats.joined).toBe(120);
      expect(stats.admitted).toBe(45);
      expect(stats.inQueue).toBe(75);
      expect(stats.totalSeats).toBe(SEAT_COUNT);
      expect(stats.seatsLeft).toBe(SEAT_COUNT);
      expect(stats.holds).toBe(2);
      // The number the whole project exists to keep at zero.
      expect(stats.oversold).toBe(0);
    });

    it('serves the same numbers over HTTP', async () => {
      const res = await fetch(`${baseUrl}/api/events/${EVENT_ID}/stats`);
      expect(res.status).toBe(200);

      const stats = await res.json();
      expect(stats.eventId).toBe(EVENT_ID);
      expect(stats.oversold).toBe(0);
      expect(typeof stats.livePods).toBe('number');
    });

    it('counts live api pods and ignores ones that stopped checking in', async () => {
      // The pod set is shared with whatever else is pointed at this Redis — a
      // dev server, another suite — so this measures the change it causes
      // rather than an absolute count it does not control.
      const before = (await readEventStats(EVENT_ID)).livePods;

      const now = Date.now();
      await redis.zadd(keys.pods, now, 'api-test-a', now, 'api-test-b');
      // A pod that last checked in a minute ago is not alive and must not count.
      await redis.zadd(keys.pods, now - 60_000, 'api-test-dead');

      const after = (await readEventStats(EVENT_ID)).livePods;
      expect(after - before).toBe(2);

      await redis.zrem(keys.pods, 'api-test-a', 'api-test-b', 'api-test-dead');
    });

    it('returns 404 for an event that does not exist', async () => {
      const res = await fetch(`${baseUrl}/api/events/nope/stats`);
      expect(res.status).toBe(404);
    });
  });
});
