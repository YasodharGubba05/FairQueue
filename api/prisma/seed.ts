import { PrismaClient, EventStatus, Role } from '@prisma/client';
import { hashPassword } from '../src/password';

const prisma = new PrismaClient();

/** A block of seats: `rows` rows of `seatsPerRow` seats, all at one price. */
type SectionSpec = {
  section: string;
  rows: number;
  seatsPerRow: number;
  /** Price in cents. */
  price: number;
  /** Top-left corner of the block on the SVG seat map. */
  originX: number;
  originY: number;
};

const SEAT_GAP = 12;
const ROW_GAP = 14;

/** A, B, ... Z, AA, AB, ... so a section can have more than 26 rows. */
function rowLabel(index: number): string {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function buildSeats(eventId: string, specs: SectionSpec[]) {
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
 * The 2,000 seat headline venue: stage at the top, floor in front of it,
 * two wings either side, then two wide tiers behind.
 *   240 + 120 + 120 + 520 + 1000 = 2000
 */
const HEADLINE_VENUE: SectionSpec[] = [
  { section: 'Floor',      rows: 10, seatsPerRow: 24, price: 25000, originX: 406, originY: 100 },
  { section: 'Left Wing',  rows: 12, seatsPerRow: 10, price: 18000, originX: 270, originY: 100 },
  { section: 'Right Wing', rows: 12, seatsPerRow: 10, price: 18000, originX: 710, originY: 100 },
  { section: 'Lower Tier', rows: 13, seatsPerRow: 40, price: 12000, originX: 310, originY: 290 },
  { section: 'Upper Tier', rows: 25, seatsPerRow: 40, price: 6000,  originX: 310, originY: 500 },
];

/** A small 400 seat room, used for the upcoming-sale card on the home page. */
const SMALL_VENUE: SectionSpec[] = [
  { section: 'Stalls',  rows: 10, seatsPerRow: 20, price: 14000, originX: 310, originY: 100 },
  { section: 'Balcony', rows: 10, seatsPerRow: 20, price: 7500,  originX: 310, originY: 290 },
];

/** A 300 seat room for the sold-out card. */
const TINY_VENUE: SectionSpec[] = [
  { section: 'General Admission', rows: 15, seatsPerRow: 20, price: 9000, originX: 310, originY: 100 },
];

const BUYER_COUNT = 2000;
const BUYER_PASSWORD = 'password123';
const ADMIN_PASSWORD = 'admin123';

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000);
}

async function main() {
  console.log('[seed] clearing existing data');
  // Order matters: tickets reference orders and seats.
  await prisma.ticket.deleteMany();
  await prisma.order.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  // Every demo buyer shares one password, so the slow scrypt hash is computed
  // once instead of 2,000 times. Real signups hash their own password.
  const buyerHash = hashPassword(BUYER_PASSWORD);

  await prisma.user.create({
    data: {
      id: 'usr_admin',
      email: 'admin@fairqueue.dev',
      passwordHash: hashPassword(ADMIN_PASSWORD),
      role: Role.ADMIN,
    },
  });

  const buyers = Array.from({ length: BUYER_COUNT }, (_, i) => {
    const n = String(i + 1).padStart(4, '0');
    return { id: `usr_buyer_${n}`, email: `buyer${n}@fairqueue.dev`, passwordHash: buyerHash, role: Role.BUYER };
  });
  await prisma.user.createMany({ data: buyers });
  console.log(`[seed] 1 admin + ${BUYER_COUNT} buyers`);

  const events = [
    {
      data: {
        id: 'evt_headline',
        name: 'Neon Districts — World Tour Finale',
        venue: 'Aurora Dome, Hyderabad',
        startsAt: minutesFromNow(60 * 24 * 45),
        // Already open, so the app and the benchmarks are usable right after seeding.
        saleOpensAt: minutesFromNow(-1),
        status: EventStatus.LIVE,
        admitPerSec: 50,
        maxSeatsPerUser: 4,
      },
      venue: HEADLINE_VENUE,
    },
    {
      data: {
        id: 'evt_clash',
        name: 'Capital Clash — Final',
        venue: 'Riverside Stadium, Mumbai',
        startsAt: minutesFromNow(60 * 24 * 70),
        // Opens in two days, which is what the home page counts down to.
        saleOpensAt: minutesFromNow(60 * 48),
        status: EventStatus.UPCOMING,
        admitPerSec: 40,
        maxSeatsPerUser: 2,
      },
      venue: SMALL_VENUE,
    },
    {
      data: {
        id: 'evt_lanterns',
        name: 'Paper Lanterns — Acoustic Night',
        venue: 'The Glasshouse, Bengaluru',
        startsAt: minutesFromNow(60 * 24 * 12),
        saleOpensAt: minutesFromNow(-60 * 24 * 3),
        status: EventStatus.SOLD_OUT,
        admitPerSec: 20,
        maxSeatsPerUser: 4,
      },
      venue: TINY_VENUE,
    },
  ];

  for (const event of events) {
    await prisma.event.create({ data: event.data });
    const seats = buildSeats(event.data.id, event.venue);
    await prisma.seat.createMany({ data: seats });
    console.log(`[seed] ${event.data.name}: ${seats.length} seats`);
  }

  console.log('[seed] done');
  console.log(`[seed] admin@fairqueue.dev / ${ADMIN_PASSWORD}`);
  console.log(`[seed] buyer0001@fairqueue.dev .. buyer${BUYER_COUNT} / ${BUYER_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
