import { EventSourceKind } from '@prisma/client';
import type { EventSource, FetchOptions, SourcedEvent } from '../types';

/**
 * The invented events the project has always had.
 *
 * They are not a stopgap. A benchmark needs a venue whose size and sale time
 * are fixed and repeatable, and a flash-sale demo needs a sale that opens when
 * you want it to rather than whenever a real promoter decided. Real events
 * cannot give either. So these stay, and they are labelled as simulated
 * wherever they appear.
 *
 * This adapter exists so that seeded events travel the same path as any other
 * source and the rest of the system has exactly one kind of event to handle.
 */
export class SeededSource implements EventSource {
  readonly kind = EventSourceKind.SEEDED;
  readonly label = 'Simulated';

  /** Always available: it is the reason the app runs with no credentials. */
  isConfigured(): boolean {
    return true;
  }

  /**
   * Nothing to fetch. Seeded events are written by `npm run seed`, which owns
   * their venue layout and sale timing; a sync must never overwrite them.
   */
  async fetchEvents(_options: FetchOptions = {}): Promise<SourcedEvent[]> {
    return [];
  }
}
