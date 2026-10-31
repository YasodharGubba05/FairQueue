import type { EventSourceKind } from '@prisma/client';

/**
 * One real-world event, normalised.
 *
 * This is the only shape the rest of FairQueue ever sees. A provider's own
 * JSON never escapes its adapter, which is what lets a new provider be added
 * without the queue, the holds, the checkout or the benchmarks knowing a
 * thing about it.
 *
 * Note what is *not* here: no seats, no prices, no availability. FairQueue
 * generates its own inventory for every event, real or seeded. A provider
 * tells us an event exists; it never tells us what we are selling.
 */
export type SourcedEvent = {
  /** The provider's own id, stable across syncs. */
  externalId: string;
  name: string;
  venue: string;
  city: string;
  country: string;
  /** Free text from the provider: "Music", "Cricket", "Theatre". */
  category: string;
  startsAt: Date;
  /**
   * The page these details came from. Required, not optional: an event that
   * claims to be real without somewhere to check it is just an assertion.
   */
  sourceUrl: string;
  /** Who said so — "Ticketmaster", "ICC", "BCCI". */
  sourceName: string;
  /**
   * Real venue capacity when the provider publishes one. Used only to size the
   * seat map we generate; it is never presented as real availability.
   */
  capacity?: number;
};

export type FetchOptions = {
  /** ISO country code to search, when the provider supports one. */
  countryCode?: string;
  city?: string;
  /** Upper bound on events returned, so one sync cannot run away. */
  limit?: number;
  /**
   * What kind of event to ask for — "Music", "Arts & Theatre", "Sports".
   * Providers name these differently, so each adapter maps it to its own
   * vocabulary rather than the caller having to know.
   */
  classification?: string;
};

/**
 * A place real events can come from.
 *
 * Adding a provider means writing one of these and registering it. Nothing in
 * the booking engine changes, because the booking engine only ever sees
 * SourcedEvent.
 */
export interface EventSource {
  readonly kind: EventSourceKind;
  /** Shown in the UI next to an event, so a reader knows who vouched for it. */
  readonly label: string;

  /**
   * False when the adapter has no credentials or no data. A source that is not
   * configured is skipped silently — the application has to run perfectly well
   * with no external credentials at all.
   */
  isConfigured(): boolean;

  fetchEvents(options?: FetchOptions): Promise<SourcedEvent[]>;
}

/** Anything a provider hands back has to survive this before it is stored. */
export function isUsableEvent(event: Partial<SourcedEvent>): event is SourcedEvent {
  return Boolean(
    event.externalId &&
      event.name &&
      event.venue &&
      event.startsAt instanceof Date &&
      !Number.isNaN(event.startsAt.getTime()) &&
      // No source URL, no claim. This is the rule that stops an unverifiable
      // event being presented as a real one.
      event.sourceUrl &&
      event.sourceName,
  );
}
