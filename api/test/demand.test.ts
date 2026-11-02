import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.MODE = 'fairqueue';
  delete process.env.TICKETMASTER_API_KEY;
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventStatus } from '@prisma/client';
import { prisma } from '../src/db';
import { redis } from '../src/redis';
import { keys } from '../src/keys';
import { defaultEndsAt } from '../src/events/lifecycle';
// The worker owns demand, so the test runs the worker's real computation.
import { buildDemand, forgetLayout } from '../../worker/src/demand';

const EVENT_ID = 'evt_demand_test';
const HOUR = 60 * 60 * 1000;

/** Two sections so a comparison between them means something. */
const LAYOUT = [
  { section: 'Floor', count: 10, price: 20000 },
  { section: 'Balcony', count: 10, price: 5000 },
];

const seatId = (section: string, n: number) =>
  `s_${EVENT_ID}_${section.toLowerCase()}_${n}`;

describe('Phase P9 — section demand', () => {
  beforeAll(async () => {
    const startsAt = new Date(Date.now() + 48 * HOUR);
    await prisma.event.upsert({
      where: { id: EVENT_ID },
      update: {},
      create: {
        id: EVENT_ID,
        name: 'Demand Test Event',
        venue: 'Demand Arena',
        startsAt,
        endsAt: defaultEndsAt(startsAt),
        saleOpensAt: new Date(Date.now() - HOUR),
        status: EventStatus.LIVE,
        admitPerSec: 100,
        maxSeatsPerUser: 4,
      },
    });

    for (const { section, count, price } of LAYOUT) {
      await prisma.seat.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          id: seatId(section, i + 1),
          eventId: EVENT_ID,
          section,
          row: 'A',
          number: i + 1,
          price,
          x: i * 12,
          y: section === 'Floor' ? 0 : 100,
        })),
        skipDuplicates: true,
      });
    }
  });

  afterAll(async () => {
    await clear();
    await prisma.seat.deleteMany({ where: { eventId: EVENT_ID } });
    await prisma.event.delete({ where: { id: EVENT_ID } }).catch(() => {});
    await prisma.$disconnect();
    await redis.quit();
  });

  async function clear() {
    await redis.del(keys.sold(EVENT_ID), keys.holds(EVENT_ID));
    forgetLayout(EVENT_ID);
  }

  beforeEach(clear);

  const demand = () => buildDemand(redis as never, prisma as never, EVENT_ID);
  const find = (sections: { section: string }[], name: string) =>
    sections.find((s) => s.section === name);

  it('counts sold and currently-held seats per section', async () => {
    await redis.sadd(keys.sold(EVENT_ID), seatId('Floor', 1), seatId('Floor', 2));
    await redis.zadd(keys.holds(EVENT_ID), Date.now() + 60_000, seatId('Floor', 3));
    await redis.zadd(keys.holds(EVENT_ID), Date.now() + 60_000, seatId('Balcony', 1));

    const { sections } = await demand();

    expect(find(sections, 'Floor')?.claimed).toBe(3);
    expect(find(sections, 'Balcony')?.claimed).toBe(1);
  });

  it('ignores a hold that has already lapsed', async () => {
    // The index is scored by expiry, so a lapsed hold is simply out of range —
    // it must not read as demand.
    await redis.zadd(keys.holds(EVENT_ID), Date.now() - 1000, seatId('Floor', 4));

    const { sections } = await demand();
    expect(find(sections, 'Floor')).toBeUndefined();
  });

  it('reports no rate on the first reading', async () => {
    // There is nothing to compare against yet, and inventing a rate from one
    // sample would be making a number up.
    await redis.sadd(keys.sold(EVENT_ID), seatId('Floor', 1));

    const { sections } = await demand();
    expect(find(sections, 'Floor')?.claimRate).toBe(0);
  });

  it('measures the rate from the change between readings', async () => {
    await redis.sadd(keys.sold(EVENT_ID), seatId('Floor', 1));
    await demand();

    await new Promise((r) => setTimeout(r, 1100));
    await redis.sadd(keys.sold(EVENT_ID), seatId('Floor', 2), seatId('Floor', 3));

    const { sections } = await demand();
    const floor = find(sections, 'Floor');

    expect(floor?.claimed).toBe(3);
    // Two seats in roughly a second.
    expect(floor?.claimRate).toBeGreaterThan(0);
    expect(floor?.claimRate).toBeLessThanOrEqual(3);
  });

  it('never reports a negative rate when holds lapse', async () => {
    // Seats going back on sale is not demand running backwards.
    await redis.zadd(keys.holds(EVENT_ID), Date.now() + 60_000, seatId('Floor', 1));
    await redis.zadd(keys.holds(EVENT_ID), Date.now() + 60_000, seatId('Floor', 2));
    await demand();

    await new Promise((r) => setTimeout(r, 1100));
    await redis.del(keys.holds(EVENT_ID));
    await redis.zadd(keys.holds(EVENT_ID), Date.now() + 60_000, seatId('Floor', 1));

    const { sections } = await demand();
    expect(find(sections, 'Floor')?.claimRate).toBe(0);
  });

  it('ranks the fastest-moving section first', async () => {
    await redis.sadd(keys.sold(EVENT_ID), seatId('Balcony', 1));
    await demand();

    await new Promise((r) => setTimeout(r, 1100));
    await redis.sadd(
      keys.sold(EVENT_ID),
      seatId('Balcony', 2),
      seatId('Balcony', 3),
      seatId('Floor', 1),
    );

    const { sections, totalClaimRate } = await demand();
    expect(sections[0].section).toBe('Balcony');
    expect(totalClaimRate).toBeGreaterThan(0);
  });

  it('returns nothing for an event with no seats', async () => {
    const { sections, totalClaimRate } = await buildDemand(
      redis as never,
      prisma as never,
      'evt_does_not_exist',
    );
    expect(sections).toEqual([]);
    expect(totalClaimRate).toBe(0);
  });
});
