import { EventSourceKind, EventStatus, type PrismaClient } from '@prisma/client';
import { collectEvents } from './registry';
import type { FetchOptions, SourcedEvent } from './types';
import {
  buildSeats,
  capacityOf,
  simulatedCapacityFor,
  simulatedPriceScaleFor,
  venueForCapacity,
} from './venue';
import { defaultEndsAt } from './lifecycle';

/**
 * Turning a provider's event into something FairQueue can run a sale on.
 *
 * Two rules govern everything here:
 *
 *  1. Seeded events are never touched. They own their venue layout and their
 *     sale timing because the benchmarks and the flash-sale demo depend on
 *     both being fixed and repeatable.
 *
 *  2. Seats are generated once, when an event first arrives, and never again.
 *     Re-generating them would cascade-delete every ticket already sold for
 *     that event. A re-sync updates the event's details and nothing else.
 */

/** How many people a synced sale lets in per second. */
const SYNCED_ADMIT_PER_SEC = 25;
const SYNCED_MAX_SEATS_PER_USER = 4;

export type IngestOutcome = {
  created: number;
  updated: number;
  skipped: number;
  seatsCreated: number;
};

/**
 * Store one provider event, or refresh it if we already have it.
 *
 * Returns what actually happened, so a sync can report honestly rather than
 * claiming to have done work it did not do.
 */
export async function upsertSourcedEvent(
  prisma: PrismaClient,
  source: EventSourceKind,
  event: SourcedEvent,
): Promise<{ action: 'created' | 'updated'; seatsCreated: number; eventId: string }> {
  // Seeded events have no provider and must never be reached this way.
  if (source === EventSourceKind.SEEDED) {
    throw new Error('Seeded events are owned by the seed script, not the sync');
  }

  const existing = await prisma.event.findUnique({
    where: { source_externalId: { source, externalId: event.externalId } },
    select: { id: true, _count: { select: { seats: true } } },
  });

  const details = {
    name: event.name,
    venue: event.venue,
    startsAt: event.startsAt,
    // Providers rarely publish an end time, so a default show length stands
    // in. This is the field visibility is derived from, so it is never null.
    endsAt: event.endsAt ?? defaultEndsAt(event.startsAt),
    category: event.category,
    city: event.city,
    country: event.country,
    sourceUrl: event.sourceUrl,
    sourceName: event.sourceName,
    lastSyncedAt: new Date(),
  };

  if (existing) {
    // Details only. Touching seats here would take the tickets with them.
    await prisma.event.update({ where: { id: existing.id }, data: details });
    return { action: 'updated', seatsCreated: 0, eventId: existing.id };
  }

  // Providers almost never publish a capacity. The venue we put on sale is
  // simulated regardless, so rather than giving every event an identical room,
  // pick a plausible size deterministically from the event's own id — the same
  // event always gets the same room, and a re-sync never changes it.
  const specs = venueForCapacity(
    event.capacity ?? simulatedCapacityFor(event.externalId),
    simulatedPriceScaleFor(event.externalId),
  );

  const created = await prisma.event.create({
    data: {
      ...details,
      source,
      externalId: event.externalId,
      // A synced event is open straight away: the point of having it here is
      // that someone can walk the queue and the seat map on it right now.
      saleOpensAt: new Date(),
      status: EventStatus.LIVE,
      admitPerSec: SYNCED_ADMIT_PER_SEC,
      maxSeatsPerUser: SYNCED_MAX_SEATS_PER_USER,
    },
    select: { id: true },
  });

  const seats = buildSeats(created.id, specs);
  await prisma.seat.createMany({ data: seats, skipDuplicates: true });

  return { action: 'created', seatsCreated: capacityOf(specs), eventId: created.id };
}

export type SyncReport = {
  ranAt: string;
  sources: {
    source: EventSourceKind;
    label: string;
    configured: boolean;
    fetched: number;
    created: number;
    updated: number;
    failed: number;
    error?: string;
  }[];
  totals: IngestOutcome;
};

/**
 * Ask every configured provider what is on, and store it.
 *
 * Nothing here throws on a provider's behalf. A dead Ticketmaster, an
 * unreadable catalogue or one malformed event all end up as a number in the
 * report, and the sale that is already running carries on untouched.
 */
export async function syncEvents(
  prisma: PrismaClient,
  options: FetchOptions = {},
): Promise<SyncReport> {
  const results = await collectEvents(options);
  const totals: IngestOutcome = { created: 0, updated: 0, skipped: 0, seatsCreated: 0 };

  const sources: SyncReport['sources'] = [];

  for (const result of results) {
    // The seeded source deliberately returns nothing: its events belong to the
    // seed script.
    if (result.kind === EventSourceKind.SEEDED) {
      sources.push({
        source: result.kind,
        label: result.label,
        configured: result.configured,
        fetched: 0,
        created: 0,
        updated: 0,
        failed: 0,
      });
      continue;
    }

    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const event of result.events) {
      try {
        const outcome = await upsertSourcedEvent(prisma, result.kind, event);
        if (outcome.action === 'created') created += 1;
        else updated += 1;
        totals.seatsCreated += outcome.seatsCreated;
      } catch (err) {
        // One bad event must not cost us the rest of the batch.
        failed += 1;
        console.warn(`[events] could not store ${event.externalId}:`, (err as Error).message);
      }
    }

    totals.created += created;
    totals.updated += updated;
    totals.skipped += failed;

    sources.push({
      source: result.kind,
      label: result.label,
      configured: result.configured,
      fetched: result.events.length,
      created,
      updated,
      failed,
      error: result.error,
    });
  }

  return { ranAt: new Date().toISOString(), sources, totals };
}
