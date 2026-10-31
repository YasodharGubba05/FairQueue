import { EventSourceKind } from '@prisma/client';
import type { EventSource, FetchOptions, SourcedEvent } from './types';
import { TicketmasterSource } from './sources/ticketmaster';
import { VerifiedCatalogueSource } from './sources/catalogue';
import { SeededSource } from './sources/seeded';

/**
 * Every place events can come from.
 *
 * Adding a provider is one entry here and one file in sources/. Nothing in the
 * queue, the holds, the checkout or the benchmarks changes, because none of
 * them has ever seen a provider — they only see rows in our own database.
 */
export const SOURCES: EventSource[] = [
  new TicketmasterSource(),
  new VerifiedCatalogueSource(),
  new SeededSource(),
];

export function sourceFor(kind: EventSourceKind): EventSource | undefined {
  return SOURCES.find((s) => s.kind === kind);
}

/** Human-readable label per source, for the UI. */
export function labelFor(kind: EventSourceKind): string {
  return sourceFor(kind)?.label ?? 'Unknown';
}

export type SyncResult = {
  kind: EventSourceKind;
  label: string;
  configured: boolean;
  events: SourcedEvent[];
  error?: string;
};

/**
 * Ask every configured source what is on.
 *
 * One provider failing is not an outage. Each is tried independently and its
 * result reported on its own, so a dead Ticketmaster still leaves the verified
 * catalogue and the seeded events exactly where they were.
 */
export async function collectEvents(options: FetchOptions = {}): Promise<SyncResult[]> {
  return Promise.all(
    SOURCES.map(async (source): Promise<SyncResult> => {
      if (!source.isConfigured()) {
        return { kind: source.kind, label: source.label, configured: false, events: [] };
      }
      try {
        return {
          kind: source.kind,
          label: source.label,
          configured: true,
          events: await source.fetchEvents(options),
        };
      } catch (err) {
        return {
          kind: source.kind,
          label: source.label,
          configured: true,
          events: [],
          error: (err as Error).message,
        };
      }
    }),
  );
}
