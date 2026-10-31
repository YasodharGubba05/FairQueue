import { vi } from 'vitest';

// Vitest sets process.env.MODE to 'test', and this suite needs the fairqueue build.
// vi.hoisted runs before the imports below, so src/env.ts reads the right mode.
vi.hoisted(() => {
  process.env.MODE = 'fairqueue';
  // This suite fires thousands of requests from one address on purpose, to
  // prove the locks hold. The rate limiter would turn most of them away before
  // they ever reached a lock, so it is off here and tested on its own in
  // botprotection.test.ts.
  process.env.RATE_LIMIT_ENABLED = 'false';
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { app } from '../src/index';
import { prisma } from '../src/db';
import { redis } from '../src/redis';
import { keys, TTL } from '../src/keys';
import { signToken } from '../src/middleware/auth';
// The worker owns admission, so the test runs the worker's real script rather
// than a copy of it.
import { ADMIT_LUA } from '../../worker/src/lua/admit';

const EVENT_ID = 'evt_test_queue';

/** One admission tick, exactly as the worker runs it. */
async function admitTick(batch: number) {
  return (await redis.eval(
    ADMIT_LUA,
    3,
    keys.admitted(EVENT_ID),
    keys.queueNext(EVENT_ID),
    keys.queue(EVENT_ID),
    EVENT_ID,
    String(batch),
    String(TTL.PASS_SECONDS),
  )) as [number, number, number];
}

async function clearQueueKeys() {
  const passKeys = await redis.keys(keys.pass(EVENT_ID, '*'));
  const memberKeys = await redis.keys(keys.queueMember(EVENT_ID, '*'));
  const all = [
    keys.queue(EVENT_ID),
    keys.queueNext(EVENT_ID),
    keys.admitted(EVENT_ID),
    ...passKeys,
    ...memberKeys,
  ];
  if (all.length > 0) await redis.del(...all);
}

describe('Phase P2 — queue join and admission order', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await prisma.event.upsert({
      where: { id: EVENT_ID },
      update: { status: 'LIVE', admitPerSec: 10 },
      create: {
        id: EVENT_ID,
        name: 'Queue Test Event',
        venue: 'Test Arena',
        startsAt: new Date(Date.now() + 86_400_000),
        // endsAt decides when an event drops out of the public listings, so
        // every event needs one. Three hours after it starts.
        endsAt: new Date(Date.now() + 86_400_000 + 3 * 60 * 60 * 1000),
        saleOpensAt: new Date(Date.now() - 1000),
        status: 'LIVE',
        admitPerSec: 10,
        maxSeatsPerUser: 4,
      },
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
    await clearQueueKeys();
    await prisma.event.delete({ where: { id: EVENT_ID } }).catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    await redis.quit();
  });

  beforeEach(clearQueueKeys);

  function join(userId: string) {
    const token = signToken({ id: userId, email: `${userId}@test.dev`, role: 'BUYER' });
    return fetch(`${baseUrl}/api/events/${EVENT_ID}/queue/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it('gives the first joiner number 1 and the next joiner number 2', async () => {
    const first = await (await join('u1')).json();
    const second = await (await join('u2')).json();

    expect(first.joinNumber).toBe(1);
    expect(second.joinNumber).toBe(2);
  });

  it('returns the same number when the same user joins again', async () => {
    const first = await (await join('u1')).json();
    const again = await (await join('u1')).json();
    const other = await (await join('u2')).json();
    const againAfter = await (await join('u1')).json();

    expect(again.joinNumber).toBe(first.joinNumber);
    expect(againAfter.joinNumber).toBe(first.joinNumber);
    // A repeat join must not burn a number either, so u2 still gets 2.
    expect(other.joinNumber).toBe(2);
  });

  it('returns the same number for 50 simultaneous joins by one user', async () => {
    const responses = await Promise.all(Array.from({ length: 50 }, () => join('u_racer')));
    const numbers = await Promise.all(responses.map((r) => r.json()));
    const distinct = new Set(numbers.map((n) => n.joinNumber));

    expect(distinct.size).toBe(1);
    expect(await redis.zcard(keys.queue(EVENT_ID))).toBe(1);
  });

  it('admits strictly in join order, admitPerSec at a time', async () => {
    const userIds = Array.from({ length: 25 }, (_, i) => `u_${String(i + 1).padStart(2, '0')}`);
    // Join one at a time so the join order is known and not up to the scheduler.
    for (const id of userIds) await join(id);

    const hasPass = async (id: string) => (await redis.exists(keys.pass(EVENT_ID, id))) === 1;

    // First tick: the first 10 only.
    const [afterFirst, joined, admittedNow] = await admitTick(10);
    expect(joined).toBe(25);
    expect(afterFirst).toBe(10);
    expect(admittedNow).toBe(10);
    expect(await hasPass('u_10')).toBe(true);
    expect(await hasPass('u_11')).toBe(false);

    // Second tick: the next 10, and nobody gets a second pass handed out twice.
    const [afterSecond, , secondNow] = await admitTick(10);
    expect(afterSecond).toBe(20);
    expect(secondNow).toBe(10);
    expect(await hasPass('u_20')).toBe(true);
    expect(await hasPass('u_21')).toBe(false);

    // Third tick: only the 5 who are left, never more than have joined.
    const [afterThird, , thirdNow] = await admitTick(10);
    expect(afterThird).toBe(25);
    expect(thirdNow).toBe(5);
    expect(await hasPass('u_25')).toBe(true);

    // Everyone who joined is now in, and the watermark stops at the last joiner.
    const [afterFourth, , fourthNow] = await admitTick(10);
    expect(afterFourth).toBe(25);
    expect(fourthNow).toBe(0);
  });

  it('reports position as join number minus admitted', async () => {
    for (let i = 1; i <= 15; i++) await join(`u_${i}`);
    await admitTick(10);

    const token = signToken({ id: 'u_12', email: 'u12@test.dev', role: 'BUYER' });
    const state = await (
      await fetch(`${baseUrl}/api/events/${EVENT_ID}/queue`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    expect(state.joinNumber).toBe(12);
    expect(state.admitted).toBe(10);
    expect(state.ahead).toBe(2);
    expect(state.hasPass).toBe(false);
  });

  it('gives an admitted user a pass that the api reports back', async () => {
    await join('u_first');
    await admitTick(10);

    const token = signToken({ id: 'u_first', email: 'first@test.dev', role: 'BUYER' });
    const state = await (
      await fetch(`${baseUrl}/api/events/${EVENT_ID}/queue`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    expect(state.hasPass).toBe(true);
    expect(state.ahead).toBe(0);
    expect(state.passExpiresInSec).toBeGreaterThan(0);
  });

  it('refuses to queue for a sale that has not opened', async () => {
    await prisma.event.update({ where: { id: EVENT_ID }, data: { status: 'UPCOMING' } });
    const res = await join('u_early');
    await prisma.event.update({ where: { id: EVENT_ID }, data: { status: 'LIVE' } });

    expect(res.status).toBe(409);
  });

  it('rejects an unauthenticated join', async () => {
    const res = await fetch(`${baseUrl}/api/events/${EVENT_ID}/queue/join`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
