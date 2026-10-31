import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.MODE = 'fairqueue';
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventSourceKind } from '@prisma/client';
import { isUsableEvent, type SourcedEvent } from '../src/events/types';
import { TicketmasterSource } from '../src/events/sources/ticketmaster';
import { VerifiedCatalogueSource } from '../src/events/sources/catalogue';
import { SeededSource } from '../src/events/sources/seeded';
import { collectEvents, labelFor, SOURCES } from '../src/events/registry';

/** A Ticketmaster payload, trimmed to the fields the adapter reads. */
function tmPayload(overrides: Record<string, unknown> = {}) {
  return {
    _embedded: {
      events: [
        {
          id: 'G5v0Z9Yq1',
          name: 'Example Festival',
          url: 'https://www.ticketmaster.com/event/G5v0Z9Yq1',
          dates: { start: { dateTime: '2027-06-14T18:30:00Z' } },
          classifications: [{ segment: { name: 'Music' }, genre: { name: 'Rock' } }],
          _embedded: {
            venues: [
              { name: 'Example Arena', city: { name: 'Manchester' }, country: { countryCode: 'GB' } },
            ],
          },
          ...overrides,
        },
      ],
    },
  };
}

describe('Phase P7 — event source adapters', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('the shape every provider must produce', () => {
    const valid: SourcedEvent = {
      externalId: 'x1',
      name: 'Example',
      venue: 'Example Arena',
      city: 'Leeds',
      country: 'GB',
      category: 'Music',
      startsAt: new Date('2027-01-01T00:00:00Z'),
      sourceUrl: 'https://example.org/event',
      sourceName: 'Example',
    };

    it('accepts a complete event', () => {
      expect(isUsableEvent(valid)).toBe(true);
    });

    it('rejects an event with nowhere to verify it', () => {
      // The rule that stops an unverifiable event being shown as a real one.
      expect(isUsableEvent({ ...valid, sourceUrl: '' })).toBe(false);
      expect(isUsableEvent({ ...valid, sourceName: '' })).toBe(false);
    });

    it('rejects an unparseable date', () => {
      expect(isUsableEvent({ ...valid, startsAt: new Date('not a date') })).toBe(false);
    });

    it('rejects an event with no provider id or no name', () => {
      expect(isUsableEvent({ ...valid, externalId: '' })).toBe(false);
      expect(isUsableEvent({ ...valid, name: '' })).toBe(false);
    });
  });

  describe('ticketmaster', () => {
    it('is not configured without a key, and fetches nothing', async () => {
      const source = new TicketmasterSource(undefined);
      expect(source.isConfigured()).toBe(false);
      expect(await source.fetchEvents()).toEqual([]);
    });

    it('normalises a response into the shared shape', async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(tmPayload()), { status: 200 })) as typeof fetch;

      const [event] = await new TicketmasterSource('test-key').fetchEvents();

      expect(event).toMatchObject({
        externalId: 'G5v0Z9Yq1',
        name: 'Example Festival',
        venue: 'Example Arena',
        city: 'Manchester',
        country: 'GB',
        category: 'Rock',
        sourceName: 'Ticketmaster',
      });
      expect(event.startsAt.toISOString()).toBe('2027-06-14T18:30:00.000Z');
      // The link back to the provider's own page is what makes it checkable.
      expect(event.sourceUrl).toContain('ticketmaster.com');
    });

    it('falls back to midday when a listing has only a local date', async () => {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify(tmPayload({ dates: { start: { localDate: '2027-06-14' } } })),
          { status: 200 },
        )) as typeof fetch;

      const [event] = await new TicketmasterSource('test-key').fetchEvents();
      expect(event.startsAt.toISOString()).toBe('2027-06-14T12:00:00.000Z');
    });

    it('drops an event that cannot be verified rather than storing it', async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(tmPayload({ url: undefined })), {
          status: 200,
        })) as typeof fetch;

      expect(await new TicketmasterSource('test-key').fetchEvents()).toEqual([]);
    });

    it('yields nothing when the provider errors, rather than throwing', async () => {
      globalThis.fetch = (async () => new Response('nope', { status: 503 })) as typeof fetch;
      expect(await new TicketmasterSource('test-key').fetchEvents()).toEqual([]);
    });

    it('yields nothing when the provider is unreachable', async () => {
      globalThis.fetch = (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch;
      expect(await new TicketmasterSource('test-key').fetchEvents()).toEqual([]);
    });
  });

  describe('the verified catalogue', () => {
    it('ships empty, so nothing is claimed to be real that has not been checked', async () => {
      const source = new VerifiedCatalogueSource();
      expect(source.isConfigured()).toBe(false);
      expect(await source.fetchEvents()).toEqual([]);
    });
  });

  describe('seeded events', () => {
    it('are always available, which is what lets the app run with no credentials', () => {
      expect(new SeededSource().isConfigured()).toBe(true);
    });

    it('are never fetched, because the seed owns their venue and sale timing', async () => {
      expect(await new SeededSource().fetchEvents()).toEqual([]);
    });
  });

  describe('the registry', () => {
    it('knows every source and gives each a label for the UI', () => {
      expect(SOURCES.map((s) => s.kind)).toEqual([
        EventSourceKind.TICKETMASTER,
        EventSourceKind.VERIFIED,
        EventSourceKind.SEEDED,
      ]);
      expect(labelFor(EventSourceKind.SEEDED)).toBe('Simulated');
      expect(labelFor(EventSourceKind.TICKETMASTER)).toBe('Ticketmaster');
    });

    it('reports each source separately so one failure is not an outage', async () => {
      const results = await collectEvents();

      expect(results).toHaveLength(3);
      // With no key and an empty catalogue, nothing is configured except the
      // seeded source — and the call still succeeds.
      expect(results.find((r) => r.kind === EventSourceKind.TICKETMASTER)?.configured).toBe(false);
      expect(results.find((r) => r.kind === EventSourceKind.SEEDED)?.configured).toBe(true);
      expect(results.every((r) => r.error === undefined)).toBe(true);
    });
  });
});
