import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EventSourceKind } from '@prisma/client';
import { isUsableEvent, type EventSource, type FetchOptions, type SourcedEvent } from '../types';

/**
 * Events verified by hand against an official organiser page.
 *
 * There is no free public API for Indian cricket or most Indian live events,
 * and scraping a ticketing site is fragile and against its terms. So this
 * reads a small curated file in which every entry carries the official page it
 * was taken from — a governing body or a venue, never a reseller.
 *
 * The file ships empty on purpose. An event is not real because we say it is;
 * it is real because there is a page you can open. Entries are added only
 * after a human has read that page.
 */
type CatalogueEntry = {
  externalId: string;
  name: string;
  venue: string;
  city: string;
  country: string;
  category: string;
  startsAt: string;
  sourceUrl: string;
  sourceName: string;
  verifiedAt: string;
  capacity?: number;
};

const CATALOGUE_PATH = path.join(__dirname, '..', 'catalogue.json');

export class VerifiedCatalogueSource implements EventSource {
  readonly kind = EventSourceKind.VERIFIED;
  readonly label = 'Verified schedule';

  // Injectable so a test can point at a fixture instead of the shipped file.
  constructor(private readonly cataloguePath: string = CATALOGUE_PATH) {}

  private read(): CatalogueEntry[] {
    try {
      const raw = readFileSync(this.cataloguePath, 'utf8');
      const parsed = JSON.parse(raw) as { events?: CatalogueEntry[] };
      return parsed.events ?? [];
    } catch (err) {
      console.warn('[events] catalogue unreadable:', (err as Error).message);
      return [];
    }
  }

  isConfigured(): boolean {
    return this.read().length > 0;
  }

  async fetchEvents(options: FetchOptions = {}): Promise<SourcedEvent[]> {
    const now = Date.now();

    const events = this.read()
      .map(
        (entry): Partial<SourcedEvent> => ({
          ...entry,
          startsAt: new Date(entry.startsAt),
        }),
      )
      .filter(isUsableEvent)
      // A schedule file goes stale quietly, so a fixture that has already been
      // played is dropped rather than shown as upcoming.
      .filter((event) => event.startsAt.getTime() > now)
      .filter((event) => !options.city || event.city.toLowerCase() === options.city.toLowerCase());

    return events.slice(0, options.limit ?? events.length);
  }
}
