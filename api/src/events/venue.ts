/**
 * Seat maps.
 *
 * Every event in FairQueue gets its inventory generated here — the seeded
 * demos and the real events alike. No events provider publishes seat
 * coordinates, and none of them would let us sell their seats anyway, so the
 * venue layout and the prices on it are ours and are simulated. A provider
 * tells us an event exists and roughly how many people fit in the room; what
 * we put on sale is this.
 */

/** A block of seats: `rows` rows of `seatsPerRow` seats, all at one price. */
export type SectionSpec = {
  section: string;
  rows: number;
  seatsPerRow: number;
  /** Price in cents, so money is never a float. */
  price: number;
  /** Top-left corner of the block on the SVG seat map. */
  originX: number;
  originY: number;
};

export const SEAT_GAP = 12;
export const ROW_GAP = 14;
/** Vertical breathing room between two sections. */
const SECTION_GAP = 46;
/** Everything is laid out around this axis so the venue reads as symmetrical. */
const CENTRE_X = 500;
const FIRST_ROW_Y = 100;

/** A, B, ... Z, AA, AB, ... so a section can have more than 26 rows. */
export function rowLabel(index: number): string {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function buildSeats(eventId: string, specs: SectionSpec[]) {
  const seats = [];
  for (const spec of specs) {
    for (let r = 0; r < spec.rows; r++) {
      const row = rowLabel(r);
      for (let s = 0; s < spec.seatsPerRow; s++) {
        const number = s + 1;
        seats.push({
          id: `s_${slug(eventId)}_${slug(spec.section)}_${row}${number}`,
          eventId,
          section: spec.section,
          row,
          number,
          price: spec.price,
          x: spec.originX + s * SEAT_GAP,
          y: spec.originY + r * ROW_GAP,
        });
      }
    }
  }
  return seats;
}

/**
 * The shape of a generated room: four price tiers, cheapest furthest back,
 * each taking a fixed share of the capacity. The widths grow as you go back,
 * which is what makes the map read as a venue rather than a grid.
 */
const TIERS = [
  { section: 'Floor', share: 0.14, price: 24_000, seatsPerRow: 22 },
  { section: 'Lower Tier', share: 0.26, price: 14_000, seatsPerRow: 30 },
  { section: 'Upper Tier', share: 0.36, price: 8_000, seatsPerRow: 38 },
  { section: 'Balcony', share: 0.24, price: 4_500, seatsPerRow: 38 },
] as const;

/** Keeps a generated venue to a size the seat map can draw smoothly. */
export const MIN_CAPACITY = 240;
export const MAX_CAPACITY = 4_000;
export const DEFAULT_CAPACITY = 1_200;

/**
 * Lay out a venue of roughly `capacity` seats.
 *
 * The result is approximate by design: rows have to be whole, so the total
 * lands near the requested number rather than exactly on it. That is fine,
 * because this inventory is simulated anyway — nothing here claims to be the
 * real seat count of a real room.
 */
export function venueForCapacity(
  capacity = DEFAULT_CAPACITY,
  /** Multiplies every tier price. See simulatedPriceScaleFor. */
  priceScale = 1,
): SectionSpec[] {
  const target = Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.round(capacity)));

  const specs: SectionSpec[] = [];
  let y = FIRST_ROW_Y;

  for (const tier of TIERS) {
    const rows = Math.max(1, Math.round((target * tier.share) / tier.seatsPerRow));
    specs.push({
      section: tier.section,
      rows,
      seatsPerRow: tier.seatsPerRow,
      // Rounded to the nearest pound so prices read as prices.
      price: Math.round((tier.price * priceScale) / 100) * 100,
      // Centred on the axis, so the blocks stack symmetrically.
      originX: CENTRE_X - ((tier.seatsPerRow - 1) * SEAT_GAP) / 2,
      originY: y,
    });
    y += rows * ROW_GAP + SECTION_GAP;
  }

  return specs;
}

export function capacityOf(specs: SectionSpec[]): number {
  return specs.reduce((total, spec) => total + spec.rows * spec.seatsPerRow, 0);
}

/**
 * A plausible room size for an event whose real capacity we do not know.
 *
 * Derived from the event's own id, so it is stable: the same event always gets
 * the same room, and a re-sync never resizes a venue somebody is mid-purchase
 * in. This is not a claim about the real venue — the inventory is simulated,
 * and this only stops every synced event looking identical.
 */
export function simulatedCapacityFor(externalId: string): number {
  const SIZES = [420, 650, 900, 1_200, 1_600, 2_200, 3_000];
  return SIZES[hashOf(externalId) % SIZES.length];
}

/**
 * How expensive this room is, relative to the base tiers.
 *
 * Without this every synced event priced identically, which made a page of
 * them look obviously generated — a stadium and a basement club cannot both
 * be the same forty-five pounds. Like the capacity it is derived from the
 * event id, so it is stable: a re-sync never reprices a seat somebody is
 * looking at.
 *
 * It is not a claim about what the real tickets cost. The inventory is
 * simulated and labelled as such wherever it appears.
 */
export function simulatedPriceScaleFor(externalId: string): number {
  const SCALES = [0.45, 0.6, 0.8, 1, 1.3, 1.7, 2.2];
  // Offset so the price and the capacity do not move together, which would
  // make every large venue the expensive one.
  return SCALES[(hashOf(externalId) + 3) % SCALES.length];
}

function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}
