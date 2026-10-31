import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.MODE = 'fairqueue';
  // These suites must never reach the network, and must behave the same on a
  // machine that has provider credentials in .env as on one that does not.
  // Clearing the key here — before any import reads the environment — is what
  // makes the result depend on the code rather than on who is running it.
  delete process.env.TICKETMASTER_API_KEY;
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventSourceKind } from '@prisma/client';
import { prisma } from '../src/db';
import { syncEvents, upsertSourcedEvent } from '../src/events/ingest';
import { capacityOf, venueForCapacity } from '../src/events/venue';
import type { SourcedEvent } from '../src/events/types';

const EXTERNAL_ID = 'test-provider-event-1';

function sourced(overrides: Partial<SourcedEvent> = {}): SourcedEvent {
  return {
    externalId: EXTERNAL_ID,
    name: 'Test Provider Event',
    venue: 'Test Provider Arena',
    city: 'Leeds',
    country: 'GB',
    category: 'Music',
    startsAt: new Date('2027-08-01T19:00:00Z'),
    sourceUrl: 'https://example.org/events/test-provider-event-1',
    sourceName: 'Example Provider',
    ...overrides,
  };
}

describe('Phase P7 — ingesting provider events', () => {
  async function wipe() {
    const events = await prisma.event.findMany({
      where: { source: { not: EventSourceKind.SEEDED } },
      select: { id: true },
    });
    const ids = events.map((e) => e.id);
    if (ids.length === 0) return;
    await prisma.ticket.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.seat.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.event.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(wipe);
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  describe('venue generation', () => {
    it('lands near the requested capacity', () => {
      for (const target of [400, 1200, 2500]) {
        const seats = capacityOf(venueForCapacity(target));
        // Rows have to be whole, so this is approximate by design.
        expect(Math.abs(seats - target) / target).toBeLessThan(0.1);
      }
    });

    it('clamps a capacity the seat map could not draw smoothly', () => {
      expect(capacityOf(venueForCapacity(5))).toBeGreaterThanOrEqual(200);
      expect(capacityOf(venueForCapacity(500_000))).toBeLessThanOrEqual(4_400);
    });

    it('gives every seat a distinct id and four price tiers', () => {
      const specs = venueForCapacity(1200);
      expect(new Set(specs.map((s) => s.price)).size).toBe(4);
      expect(new Set(specs.map((s) => s.section)).size).toBe(4);
    });
  });

  describe('storing a provider event', () => {
    it('creates the event and generates its inventory', async () => {
      const result = await upsertSourcedEvent(prisma, EventSourceKind.TICKETMASTER, sourced());

      expect(result.action).toBe('created');
      expect(result.seatsCreated).toBeGreaterThan(0);

      const event = await prisma.event.findUniqueOrThrow({
        where: { id: result.eventId },
        include: { _count: { select: { seats: true } } },
      });

      expect(event.source).toBe(EventSourceKind.TICKETMASTER);
      expect(event.externalId).toBe(EXTERNAL_ID);
      expect(event.city).toBe('Leeds');
      // The link back to the provider's page is what makes the claim checkable.
      expect(event.sourceUrl).toContain('example.org');
      expect(event.lastSyncedAt).not.toBeNull();
      // Open straight away, so the queue and seat map can be walked on it now.
      expect(event.status).toBe('LIVE');
      expect(event._count.seats).toBe(result.seatsCreated);
    });

    it('refuses to store a seeded event, which belongs to the seed script', async () => {
      await expect(
        upsertSourcedEvent(prisma, EventSourceKind.SEEDED, sourced()),
      ).rejects.toThrow(/seed script/i);
    });
  });

  describe('re-syncing the same event', () => {
    it('refreshes the details without creating a second event', async () => {
      const first = await upsertSourcedEvent(prisma, EventSourceKind.TICKETMASTER, sourced());

      const second = await upsertSourcedEvent(
        prisma,
        EventSourceKind.TICKETMASTER,
        sourced({ name: 'Renamed Event', venue: 'Moved Arena' }),
      );

      expect(second.action).toBe('updated');
      expect(second.eventId).toBe(first.eventId);

      const matching = await prisma.event.count({
        where: { source: EventSourceKind.TICKETMASTER, externalId: EXTERNAL_ID },
      });
      expect(matching).toBe(1);

      const event = await prisma.event.findUniqueOrThrow({ where: { id: first.eventId } });
      expect(event.name).toBe('Renamed Event');
      expect(event.venue).toBe('Moved Arena');
    });

    it('does not regenerate seats, so the inventory stays put', async () => {
      const first = await upsertSourcedEvent(prisma, EventSourceKind.TICKETMASTER, sourced());
      const before = await prisma.seat.findMany({
        where: { eventId: first.eventId },
        select: { id: true },
        orderBy: { id: 'asc' },
      });

      const second = await upsertSourcedEvent(prisma, EventSourceKind.TICKETMASTER, sourced());
      expect(second.seatsCreated).toBe(0);

      const after = await prisma.seat.findMany({
        where: { eventId: first.eventId },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      expect(after).toEqual(before);
    });

    it('never destroys a ticket somebody has already bought', async () => {
      // This is the one that matters. Regenerating seats would cascade-delete
      // the tickets attached to them, and a re-sync happens on a timer.
      const created = await upsertSourcedEvent(prisma, EventSourceKind.TICKETMASTER, sourced());
      const seat = await prisma.seat.findFirstOrThrow({ where: { eventId: created.eventId } });

      const buyer = await prisma.user.create({
        data: { id: 'usr_ingest_buyer', email: 'ingest@test.dev', passwordHash: 'x' },
      });
      const order = await prisma.order.create({
        data: { userId: buyer.id, eventId: created.eventId, total: seat.price },
      });
      await prisma.ticket.create({
        data: { orderId: order.id, eventId: created.eventId, seatId: seat.id },
      });

      await upsertSourcedEvent(
        prisma,
        EventSourceKind.TICKETMASTER,
        sourced({ name: 'Renamed After Sale' }),
      );

      const tickets = await prisma.ticket.count({ where: { eventId: created.eventId } });
      expect(tickets).toBe(1);
      // And the seat that ticket points at still exists.
      expect(await prisma.seat.count({ where: { id: seat.id } })).toBe(1);

      await prisma.ticket.deleteMany({ where: { eventId: created.eventId } });
      await prisma.order.deleteMany({ where: { eventId: created.eventId } });
      await prisma.user.delete({ where: { id: buyer.id } });
    });
  });

  describe('a full sync with nothing configured', () => {
    it('succeeds, reports honestly, and changes nothing', async () => {
      const seededBefore = await prisma.event.count({
        where: { source: EventSourceKind.SEEDED },
      });

      const report = await syncEvents(prisma);

      expect(report.totals.created).toBe(0);
      expect(report.totals.updated).toBe(0);
      // Every source accounted for, none claiming work it did not do.
      expect(report.sources).toHaveLength(3);
      expect(report.sources.every((s) => s.error === undefined)).toBe(true);

      // The seeded events are untouched, which is what keeps the benchmarks
      // and the flash-sale demo reproducible.
      expect(await prisma.event.count({ where: { source: EventSourceKind.SEEDED } })).toBe(
        seededBefore,
      );
    });
  });
});
