import type { Seat, SeatStatus } from './types';

/**
 * Seats are laid out by the seeder on a fixed coordinate grid, so the SVG view
 * box is worked out from the seats themselves rather than hard-coded. A venue
 * with a different shape then renders correctly with no change here.
 */
export const SEAT_RADIUS = 4.2;
const PADDING = 34;
const STAGE_HEIGHT = 26;
const STAGE_GAP = 34;

export type ViewBox = { x: number; y: number; width: number; height: number };

export type Stage = { x: number; y: number; width: number; height: number };

export function computeLayout(seats: Seat[]): { viewBox: ViewBox; stage: Stage } {
  if (seats.length === 0) {
    return {
      viewBox: { x: 0, y: 0, width: 100, height: 100 },
      stage: { x: 10, y: 10, width: 80, height: 10 },
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of seats) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }

  // The stage sits above the first row, which is what "stage at the top" means
  // to someone picking a seat.
  const stage: Stage = {
    x: minX,
    y: minY - STAGE_GAP - STAGE_HEIGHT,
    width: maxX - minX,
    height: STAGE_HEIGHT,
  };

  return {
    viewBox: {
      x: minX - PADDING,
      y: stage.y - PADDING,
      width: maxX - minX + PADDING * 2,
      height: maxY - stage.y + PADDING * 2,
    },
    stage,
  };
}

/**
 * Price tiers, most expensive first. Colour comes from the price rather than
 * the section name, so the legend reads as a price key — which is what a buyer
 * is actually scanning for.
 */
export type PriceTier = { price: number; tier: 1 | 2 | 3 | 4; sections: string[] };

export function priceTiers(seats: Seat[]): PriceTier[] {
  const byPrice = new Map<number, Set<string>>();
  for (const s of seats) {
    let sections = byPrice.get(s.price);
    if (!sections) {
      sections = new Set();
      byPrice.set(s.price, sections);
    }
    sections.add(s.section);
  }

  return [...byPrice.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 4)
    .map(([price, sections], i) => ({
      price,
      tier: (i + 1) as 1 | 2 | 3 | 4,
      sections: [...sections],
    }));
}

export function tierForPrice(tiers: PriceTier[], price: number): 1 | 2 | 3 | 4 {
  return tiers.find((t) => t.price === price)?.tier ?? 4;
}

/** The fill a seat should have, given what has happened to it. */
export function seatFill(status: SeatStatus, selected: boolean, tier: number): string {
  // Your own seats are the foreground colour: in a monochrome interface, plain
  // white is the loudest a thing can be, and it cannot clash with a price tier.
  if (selected) return 'hsl(var(--foreground))';
  if (status === 'sold') return 'hsl(var(--seat-sold))';
  if (status === 'held') return 'hsl(var(--seat-held))';
  return `hsl(var(--tier-${tier}))`;
}

export function isPickable(status: SeatStatus, selected: boolean) {
  return selected || status === 'available';
}

/**
 * Seats grouped into rows, so arrow keys can move along a row and between
 * rows. Tabbing through 2,000 separate seats would be unusable, so the map is
 * one tab stop with roving focus inside it — the pattern a grid widget uses.
 */
export type SeatGrid = { rows: Seat[][]; indexOf: Map<string, [number, number]> };

export function buildGrid(seats: Seat[]): SeatGrid {
  const byRow = new Map<string, Seat[]>();
  for (const s of seats) {
    const key = `${s.section}\u0000${s.row}`;
    const row = byRow.get(key);
    if (row) row.push(s);
    else byRow.set(key, [s]);
  }

  const rows = [...byRow.values()]
    .map((row) => [...row].sort((a, b) => a.number - b.number))
    // Top of the venue first, then left to right, so arrow keys match what the
    // eye expects on screen.
    .sort((a, b) => a[0].y - b[0].y || a[0].x - b[0].x);

  const indexOf = new Map<string, [number, number]>();
  rows.forEach((row, r) => row.forEach((seat, c) => indexOf.set(seat.id, [r, c])));

  return { rows, indexOf };
}
