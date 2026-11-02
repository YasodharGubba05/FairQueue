import type { Seat, SeatStatus } from './types';

/**
 * Section totals, derived from the seat state the page already holds.
 *
 * Nothing is fetched for this. The seat map loads every seat with its status
 * and keeps it current from the 250 ms broadcast, so the counts are already
 * here — asking the server for them again would mean two sources for one
 * number, and two sources for one number eventually disagree.
 *
 * The one thing that is NOT derived is the rate. A browser only knows what has
 * happened since it loaded, so "which section is moving fastest" has to come
 * from the worker, and is merged in by section name.
 */
export type SectionSummary = {
  section: string;
  price: number;
  total: number;
  available: number;
  held: number;
  sold: number;
  /** Sold plus held, over the section's size. 0–1. */
  takenShare: number;
  /** Seats per second, from the worker. Null until the first tick arrives. */
  claimRate: number | null;
};

export function summariseSections(
  seats: Seat[],
  statuses: Record<string, SeatStatus>,
  rates: Record<string, number> = {},
): SectionSummary[] {
  const bySection = new Map<string, SectionSummary>();

  for (const seat of seats) {
    let entry = bySection.get(seat.section);
    if (!entry) {
      entry = {
        section: seat.section,
        // Sections are single-priced in every venue the generator builds, so
        // the first seat's price is the section's price.
        price: seat.price,
        total: 0,
        available: 0,
        held: 0,
        sold: 0,
        takenShare: 0,
        claimRate: null,
      };
      bySection.set(seat.section, entry);
    }

    entry.total += 1;
    const status = statuses[seat.id] ?? seat.status;
    if (status === 'sold') entry.sold += 1;
    else if (status === 'held') entry.held += 1;
    else entry.available += 1;
  }

  return [...bySection.values()]
    .map((entry) => ({
      ...entry,
      takenShare: entry.total > 0 ? (entry.sold + entry.held) / entry.total : 0,
      claimRate: entry.section in rates ? rates[entry.section] : null,
    }))
    // Most expensive first, which is how a venue is usually read.
    .sort((a, b) => b.price - a.price);
}

/** The section going fastest right now, if anything is moving at all. */
export function hottestSection(sections: SectionSummary[]): SectionSummary | null {
  const moving = sections.filter((s) => (s.claimRate ?? 0) > 0);
  if (moving.length === 0) return null;
  return moving.reduce((best, s) => ((s.claimRate ?? 0) > (best.claimRate ?? 0) ? s : best));
}
