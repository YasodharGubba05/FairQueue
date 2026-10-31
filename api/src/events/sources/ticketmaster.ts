import { EventSourceKind } from '@prisma/client';
import { env } from '../../env';
import { isUsableEvent, type EventSource, type FetchOptions, type SourcedEvent } from '../types';

/**
 * Live events from the Ticketmaster Discovery API.
 *
 * The key is read from the server environment and never reaches a browser:
 * every call to this provider happens here, on the api, and the frontend only
 * ever sees normalised events from our own database.
 *
 * Their terms restrict caching and replication, so a sync refreshes rather
 * than hoards, and every stored event keeps the link back to its page.
 */
const BASE_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';
const TIMEOUT_MS = 10_000;

/** Only the fields we actually read, so a change elsewhere cannot break us. */
type TicketmasterEvent = {
  id?: string;
  name?: string;
  url?: string;
  dates?: {
    start?: { dateTime?: string; localDate?: string };
    end?: { dateTime?: string };
  };
  classifications?: { segment?: { name?: string }; genre?: { name?: string } }[];
  _embedded?: {
    venues?: {
      name?: string;
      city?: { name?: string };
      country?: { name?: string; countryCode?: string };
    }[];
  };
};

export class TicketmasterSource implements EventSource {
  readonly kind = EventSourceKind.TICKETMASTER;
  readonly label = 'Ticketmaster';

  // Taken as an argument rather than read from the environment at call time,
  // so this adapter can be exercised without a real key and without anything
  // reaching outside the process.
  constructor(private readonly apiKey: string | undefined = env.TICKETMASTER_API_KEY) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchEvents(options: FetchOptions = {}): Promise<SourcedEvent[]> {
    if (!this.isConfigured()) return [];

    const params = new URLSearchParams({
      apikey: this.apiKey!,
      size: String(Math.min(options.limit ?? 40, 200)),
      sort: 'date,asc',
      // Only events that have not already happened.
      startDateTime: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });
    if (options.countryCode) params.set('countryCode', options.countryCode);
    if (options.city) params.set('city', options.city);
    // Their own segment vocabulary: "Music", "Arts & Theatre", "Sports".
    if (options.classification) params.set('classificationName', options.classification);

    // A slow provider must never hold up a sync tick.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${BASE_URL}?${params}`, { signal: controller.signal });
      if (!res.ok) {
        console.warn(`[events] ticketmaster responded ${res.status}`);
        return [];
      }

      const body = (await res.json()) as { _embedded?: { events?: TicketmasterEvent[] } };
      return (body._embedded?.events ?? []).map(normalise).filter(isUsableEvent);
    } catch (err) {
      // An unreachable provider is not an outage: the catalogue and the seeded
      // events are still there, so this logs and yields nothing.
      console.warn('[events] ticketmaster fetch failed:', (err as Error).message);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalise(raw: TicketmasterEvent): Partial<SourcedEvent> {
  const venue = raw._embedded?.venues?.[0];
  const start = raw.dates?.start;
  // Some listings carry only a local date with no time; midday is a more
  // honest guess than midnight for an event we only know the day of.
  const startsAt = start?.dateTime
    ? new Date(start.dateTime)
    : start?.localDate
      ? new Date(`${start.localDate}T12:00:00Z`)
      : undefined;

  const classification = raw.classifications?.[0];

  return {
    externalId: raw.id,
    name: raw.name,
    venue: venue?.name,
    city: venue?.city?.name ?? '',
    country: venue?.country?.countryCode ?? venue?.country?.name ?? '',
    category: classification?.genre?.name ?? classification?.segment?.name ?? 'Event',
    startsAt,
    // Published only occasionally; the ingest falls back to a show length.
    endsAt: raw.dates?.end?.dateTime ? new Date(raw.dates.end.dateTime) : undefined,
    // Their own page for the event: the thing that makes this checkable.
    sourceUrl: raw.url,
    sourceName: 'Ticketmaster',
  };
}
