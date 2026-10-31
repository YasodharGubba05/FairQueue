import { vi } from 'vitest';

// Vitest sets process.env.MODE to 'test', and this suite needs the fairqueue build.
// vi.hoisted runs before the imports below, so src/env.ts reads the right mode.
vi.hoisted(() => {
  process.env.MODE = 'fairqueue';
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { app } from '../src/index';
import { prisma } from '../src/db';
import { redis } from '../src/redis';
import { keys, TTL } from '../src/keys';
import { signToken } from '../src/middleware/auth';
import { stopSeatUpdates } from '../src/seatUpdates';
// The worker owns hold expiry, so the test runs the worker's real script.
import { EXPIRE_HOLDS_LUA } from '../../worker/src/lua/expire';

const EVENT_ID = 'evt_test_holds';
const SEAT_COUNT = 40;
const seatId = (n: number) => `s_test_holds_${n}`;

function token(userId: string) {
  return signToken({ id: userId, email: `${userId}@test.dev`, role: 'BUYER' });
}

/**
 * Buyers who reach checkout need a real row, because an order has a foreign key
 * to the user who placed it. The hold tests never touch Postgres, so they can
 * use any id they like; these are the ones that go on to buy something.
 */
const BUYING_USERS = [
  'u_buyer',
  'u_a',
  'u_b',
  'u_nohold',
  'u_declined',
  'u_lapsed',
  ...Array.from({ length: 50 }, (_, i) => `u_rush_${i}`),
];

/** Give a user an admission pass, as the worker would on admitting them. */
async function givePass(userId: string) {
  await redis.set(keys.pass(EVENT_ID, userId), '1', 'EX', TTL.PASS_SECONDS);
}

describe('Phase P3 — seat holds, checkout and expiry', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await prisma.event.upsert({
      where: { id: EVENT_ID },
      update: { status: 'LIVE', maxSeatsPerUser: 4 },
      create: {
        id: EVENT_ID,
        name: 'Hold Test Event',
        venue: 'Test Arena',
        startsAt: new Date(Date.now() + 86_400_000),
        saleOpensAt: new Date(Date.now() - 1000),
        status: 'LIVE',
        admitPerSec: 100,
        maxSeatsPerUser: 4,
      },
    });

    await prisma.user.createMany({
      data: BUYING_USERS.map((id) => ({
        id,
        email: `${id}@test.dev`,
        passwordHash: 'not-used-in-these-tests',
      })),
      skipDuplicates: true,
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

    // These tests are about the locks, so the database backstop must be in
    // place exactly as it is in fairqueue mode.
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_eventId_seatId_key" ON "Ticket"("eventId","seatId")`,
    );

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
    await prisma.ticket.deleteMany({ where: { eventId: EVENT_ID } });
    await prisma.order.deleteMany({ where: { eventId: EVENT_ID } });
    await prisma.seat.deleteMany({ where: { eventId: EVENT_ID } });
    await prisma.event.delete({ where: { id: EVENT_ID } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: BUYING_USERS } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    await redis.quit();
  });

  async function clearRedis() {
    const patterns = [
      `hold:${EVENT_ID}:*`,
      `pass:${EVENT_ID}:*`,
      `userseats:${EVENT_ID}:*`,
    ];
    for (const pattern of patterns) {
      const found = await redis.keys(pattern);
      if (found.length > 0) await redis.del(...found);
    }
    await redis.del(keys.holds(EVENT_ID), keys.sold(EVENT_ID));
  }

  beforeEach(async () => {
    await clearRedis();
    await prisma.ticket.deleteMany({ where: { eventId: EVENT_ID } });
    await prisma.order.deleteMany({ where: { eventId: EVENT_ID } });
  });

  function hold(userId: string, seatIds: string[]) {
    return fetch(`${baseUrl}/api/events/${EVENT_ID}/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(userId)}` },
      body: JSON.stringify({ seatIds }),
    });
  }

  function checkout(userId: string, seatIds: string[], payment?: unknown) {
    return fetch(`${baseUrl}/api/events/${EVENT_ID}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(userId)}` },
      body: JSON.stringify({ seatIds, payment }),
    });
  }

  describe('the hold is a real lock', () => {
    it('lets exactly one of 1,000 simultaneous holds win the same seat', async () => {
      const users = Array.from({ length: 1000 }, (_, i) => `u_race_${i}`);
      await Promise.all(users.map(givePass));

      const responses = await Promise.all(users.map((u) => hold(u, [seatId(0)])));
      const won = responses.filter((r) => r.status === 201);

      expect(won.length).toBe(1);
      // Everybody else was told the seat is taken, not handed an error page.
      expect(responses.filter((r) => r.status === 409).length).toBe(999);

      // And Redis agrees there is exactly one holder.
      const holder = await redis.get(keys.hold(EVENT_ID, seatId(0)));
      expect(holder).toBeTruthy();
      expect(users).toContain(holder);
    });

    it('refuses a hold without an admission pass, so bots cannot skip the line', async () => {
      const res = await hold('u_bot', [seatId(1)]);
      expect(res.status).toBe(403);
      expect(await redis.exists(keys.hold(EVENT_ID, seatId(1)))).toBe(0);
    });

    it('is idempotent: holding a seat you already hold does not use up your cap', async () => {
      await givePass('u_again');
      expect((await hold('u_again', [seatId(2)])).status).toBe(201);
      expect((await hold('u_again', [seatId(2)])).status).toBe(201);

      expect(await redis.scard(keys.userSeats(EVENT_ID, 'u_again'))).toBe(1);
    });
  });

  describe('a multi-seat hold is all or nothing', () => {
    it('holds none of the four when one of them is already taken', async () => {
      await givePass('u_first');
      await givePass('u_second');

      await hold('u_first', [seatId(5)]);

      const wanted = [seatId(4), seatId(5), seatId(6), seatId(7)];
      const res = await hold('u_second', wanted);
      expect(res.status).toBe(409);

      // The three free seats must still be free: no partial hold was left behind.
      for (const id of [seatId(4), seatId(6), seatId(7)]) {
        expect(await redis.exists(keys.hold(EVENT_ID, id))).toBe(0);
      }
      expect(await redis.scard(keys.userSeats(EVENT_ID, 'u_second'))).toBe(0);
    });

    it('holds all four together when every seat is free', async () => {
      await givePass('u_four');
      const wanted = [seatId(10), seatId(11), seatId(12), seatId(13)];

      expect((await hold('u_four', wanted)).status).toBe(201);
      for (const id of wanted) {
        expect(await redis.get(keys.hold(EVENT_ID, id))).toBe('u_four');
      }
    });

    it('enforces the per-user cap across separate holds', async () => {
      await givePass('u_greedy');
      expect((await hold('u_greedy', [seatId(20), seatId(21)])).status).toBe(201);
      expect((await hold('u_greedy', [seatId(22), seatId(23)])).status).toBe(201);

      // Four is the cap for this event, so the fifth seat is refused outright.
      const res = await hold('u_greedy', [seatId(24)]);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain('at most 4');
    });

    it('releases only the seats the caller is actually holding', async () => {
      await givePass('u_owner');
      await givePass('u_thief');
      await hold('u_owner', [seatId(30)]);

      const res = await fetch(`${baseUrl}/api/events/${EVENT_ID}/holds`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token('u_thief')}`,
        },
        body: JSON.stringify({ seatIds: [seatId(30)] }),
      });

      expect((await res.json()).released).toEqual([]);
      expect(await redis.get(keys.hold(EVENT_ID, seatId(30)))).toBe('u_owner');
    });
  });

  describe('checkout can never sell a seat twice', () => {
    it('writes one ticket per seat and marks them sold', async () => {
      await givePass('u_buyer');
      await hold('u_buyer', [seatId(14), seatId(15)]);

      const res = await checkout('u_buyer', [seatId(14), seatId(15)]);
      expect(res.status).toBe(201);

      const tickets = await prisma.ticket.findMany({ where: { eventId: EVENT_ID } });
      expect(tickets.length).toBe(2);
      expect(await redis.sismember(keys.sold(EVENT_ID), seatId(14))).toBe(1);
      // Selling the seat drops the hold, so nobody can hold it again.
      expect(await redis.exists(keys.hold(EVENT_ID, seatId(14)))).toBe(0);
    });

    it('refuses a second checkout of the same seats and creates no extra tickets', async () => {
      await givePass('u_a');
      await givePass('u_b');
      await hold('u_a', [seatId(16)]);
      expect((await checkout('u_a', [seatId(16)])).status).toBe(201);

      // The same buyer trying again, and a different buyer trying at all.
      expect((await checkout('u_a', [seatId(16)])).status).toBe(409);
      expect((await checkout('u_b', [seatId(16)])).status).toBe(409);

      const tickets = await prisma.ticket.findMany({
        where: { eventId: EVENT_ID, seatId: seatId(16) },
      });
      expect(tickets.length).toBe(1);
    });

    it('creates exactly one ticket when 50 buyers check out the same seat at once', async () => {
      const users = Array.from({ length: 50 }, (_, i) => `u_rush_${i}`);
      await Promise.all(users.map(givePass));
      // Every one of them claims to be holding it, so only the locks and the
      // database constraint stand between this and a double sell.
      await Promise.all(
        users.map((u) => redis.sadd(keys.userSeats(EVENT_ID, u), seatId(17))),
      );
      await redis.set(keys.hold(EVENT_ID, seatId(17)), users[0]);
      await redis.zadd(keys.holds(EVENT_ID), Date.now() + 60_000, seatId(17));

      const responses = await Promise.all(users.map((u) => checkout(u, [seatId(17)])));
      expect(responses.filter((r) => r.status === 201).length).toBe(1);

      const tickets = await prisma.ticket.findMany({
        where: { eventId: EVENT_ID, seatId: seatId(17) },
      });
      expect(tickets.length).toBe(1);
    });

    it('refuses checkout for a seat the buyer is not holding', async () => {
      await givePass('u_nohold');
      const res = await checkout('u_nohold', [seatId(18)]);
      expect(res.status).toBe(409);
      expect(await prisma.ticket.count({ where: { eventId: EVENT_ID } })).toBe(0);
    });

    it('keeps the seats held when the mock payment is declined', async () => {
      await givePass('u_declined');
      await hold('u_declined', [seatId(19)]);

      const res = await checkout('u_declined', [seatId(19)], {
        cardNumber: '4242424242420000',
        name: 'Test Buyer',
      });

      expect(res.status).toBe(402);
      expect(await redis.get(keys.hold(EVENT_ID, seatId(19)))).toBe('u_declined');
      expect(await prisma.ticket.count({ where: { eventId: EVENT_ID } })).toBe(0);
    });
  });

  describe('expired holds come back on sale', () => {
    /** One sweep, exactly as the worker runs it. */
    async function expireSweep() {
      return (await redis.eval(
        EXPIRE_HOLDS_LUA,
        1,
        keys.holds(EVENT_ID),
        EVENT_ID,
        String(Date.now()),
        '500',
      )) as string[];
    }

    it('releases a hold whose time is up and leaves a live one alone', async () => {
      await givePass('u_slow');
      await hold('u_slow', [seatId(25), seatId(26)]);

      // Backdate one seat's expiry so it is due, exactly as five minutes would.
      await redis.zadd(keys.holds(EVENT_ID), Date.now() - 1000, seatId(25));

      const released = await expireSweep();
      expect(released).toEqual([seatId(25)]);

      expect(await redis.exists(keys.hold(EVENT_ID, seatId(25)))).toBe(0);
      expect(await redis.get(keys.hold(EVENT_ID, seatId(26)))).toBe('u_slow');
    });

    it('frees the seat for the next buyer and gives the cap back', async () => {
      await givePass('u_gone');
      await givePass('u_next');
      await hold('u_gone', [seatId(27)]);
      await redis.zadd(keys.holds(EVENT_ID), Date.now() - 1000, seatId(27));

      await expireSweep();

      // The seat no longer counts against the buyer who let it lapse...
      expect(await redis.sismember(keys.userSeats(EVENT_ID, 'u_gone'), seatId(27))).toBe(0);
      // ...and somebody else can take it straight away.
      expect((await hold('u_next', [seatId(27)])).status).toBe(201);
    });

    it('stops an expired hold from being checked out', async () => {
      await givePass('u_lapsed');
      await hold('u_lapsed', [seatId(28)]);
      await redis.zadd(keys.holds(EVENT_ID), Date.now() - 1000, seatId(28));
      await expireSweep();

      const res = await checkout('u_lapsed', [seatId(28)]);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain('ran out');
    });

    it('does not report a seat map hold that has already run out', async () => {
      await givePass('u_stale');
      await hold('u_stale', [seatId(29)]);
      await redis.zadd(keys.holds(EVENT_ID), Date.now() - 1000, seatId(29));

      // Even before the worker sweeps, the seat map reads holds by expiry time,
      // so a lapsed hold never shows as held.
      const seats = await (await fetch(`${baseUrl}/api/events/${EVENT_ID}/seats`)).json();
      const seat = seats.seats.find((s: { id: string }) => s.id === seatId(29));
      expect(seat.status).toBe('available');
    });
  });
});
