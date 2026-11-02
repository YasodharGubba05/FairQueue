import { execSync } from 'node:child_process';
import os from 'node:os';
import { PrismaClient } from '../api/node_modules/@prisma/client';
import Redis from '../api/node_modules/ioredis';

/**
 * The parts of a benchmark that are not the load itself.
 *
 * Everything here exists to make a comparison between naive and fairqueue
 * mean something. Two runs are only comparable if they started from the same
 * state, on the same machine, under the same workload — so the harness resets
 * the state, records the machine and the workload, and verifies the result
 * against Postgres afterwards rather than trusting what the api reported.
 */

export const EVENT_ID = process.env.BENCH_EVENT_ID ?? 'evt_headline';

/**
 * Pinned for every run, and recorded in the result file.
 *
 * admitPerSec lives in a database row that a demo or an admin can change, and
 * one did: a run found it left at 3 from a waiting-room demo, which made
 * admission the bottleneck instead of the service and quietly invalidated the
 * comparison. A benchmark cannot take its own parameters from mutable state.
 */
export const BENCH_ADMIT_PER_SEC = Number(process.env.BENCH_ADMIT_PER_SEC ?? 500);
export const BENCH_MAX_SEATS_PER_USER = Number(process.env.BENCH_MAX_SEATS_PER_USER ?? 4);

export type MachineSpec = {
  cpuModel: string;
  cpuCores: number;
  memoryGb: number;
  platform: string;
  osRelease: string;
  arch: string;
  nodeVersion: string;
  postgresVersion: string;
  redisVersion: string;
  k6Version: string;
};

function quiet(command: string, fallback = 'unknown'): string {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
}

/**
 * Recorded with every result, because "4,200 requests a second" means nothing
 * without the machine that did it.
 */
export async function machineSpec(prisma: PrismaClient, redis: Redis): Promise<MachineSpec> {
  const cpus = os.cpus();

  const pg = await prisma
    .$queryRaw<{ version: string }[]>`SELECT version() AS version`
    .then((rows) => rows[0]?.version ?? 'unknown')
    .catch(() => 'unknown');

  const redisInfo = await redis.info('server').catch(() => '');
  const redisVersion = /redis_version:([^\r\n]+)/.exec(redisInfo)?.[1] ?? 'unknown';

  return {
    cpuModel: cpus[0]?.model ?? 'unknown',
    cpuCores: cpus.length,
    memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    platform: os.platform(),
    osRelease: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    // Just the version number, not the whole compiler banner.
    postgresVersion: /PostgreSQL ([\d.]+)/.exec(pg)?.[1] ?? pg.slice(0, 40),
    redisVersion,
    k6Version: quiet('k6 version').split('\n')[0],
  };
}

/**
 * Put the database and Redis back to the state a sale starts from.
 *
 * This is the part that makes the naive and fairqueue numbers comparable: both
 * runs begin with the same 2,000 free seats, an empty queue and no holds. The
 * seeded events and their seats are left alone — only what a sale produces is
 * cleared.
 */
export async function resetSaleState(prisma: PrismaClient, redis: Redis, eventId = EVENT_ID) {
  await prisma.ticket.deleteMany({ where: { eventId } });
  await prisma.order.deleteMany({ where: { eventId } });

  // Pin the sale's own parameters, so a run is not silently shaped by whatever
  // the row happened to contain.
  await prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'LIVE',
      admitPerSec: BENCH_ADMIT_PER_SEC,
      maxSeatsPerUser: BENCH_MAX_SEATS_PER_USER,
      saleOpensAt: new Date(Date.now() - 60_000),
      // Far enough out that the lifecycle sweep cannot retire it mid-run.
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const patterns = [
    `queue:*${eventId}*`,
    `admitted:${eventId}`,
    `pass:${eventId}:*`,
    `hold:${eventId}:*`,
    `userseats:${eventId}:*`,
    `stats:${eventId}:*`,
    'rate:*',
  ];
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  }
  await redis.del(`holds:${eventId}`, `sold:${eventId}`, `queue:${eventId}`);
}

/**
 * The unique index is the naive build's missing safety net, so each mode needs
 * it in the right state before the run — and the tickets have to be gone
 * first, or Postgres cannot rebuild the index over duplicate rows.
 */
export async function setIndexForMode(prisma: PrismaClient, mode: 'naive' | 'fairqueue') {
  if (mode === 'naive') {
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Ticket_eventId_seatId_key"`);
  } else {
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_eventId_seatId_key" ON "Ticket"("eventId","seatId")`,
    );
  }
}

export type DatabaseVerdict = {
  orders: number;
  tickets: number;
  distinctSeatsSold: number;
  /** Seats with more than one ticket. The number the project exists to keep at 0. */
  oversoldSeats: number;
  /** Tickets beyond the first for each seat — how many people were double sold. */
  duplicateTickets: number;
  seatsOverCapacity: number;
  uniqueIndexPresent: boolean;
};

/**
 * Count the damage in Postgres.
 *
 * Deliberately not asked of the api or of Redis: whether the locks worked is
 * not a question to put to the locks. This reads the permanent record, which
 * is the only witness that cannot be talked round.
 */
export async function verifyDatabase(
  prisma: PrismaClient,
  eventId = EVENT_ID,
): Promise<DatabaseVerdict> {
  const [rows] = await prisma.$queryRaw<
    {
      orders: bigint;
      tickets: bigint;
      distinct_seats: bigint;
      oversold_seats: bigint;
      duplicate_tickets: bigint;
    }[]
  >`
    SELECT
      (SELECT COUNT(*) FROM "Order"  WHERE "eventId" = ${eventId})                        AS orders,
      (SELECT COUNT(*) FROM "Ticket" WHERE "eventId" = ${eventId})                        AS tickets,
      (SELECT COUNT(DISTINCT "seatId") FROM "Ticket" WHERE "eventId" = ${eventId})        AS distinct_seats,
      (SELECT COUNT(*) FROM (
         SELECT "seatId" FROM "Ticket" WHERE "eventId" = ${eventId}
         GROUP BY "seatId" HAVING COUNT(*) > 1
       ) d)                                                                               AS oversold_seats,
      (SELECT COALESCE(SUM(extra), 0) FROM (
         SELECT COUNT(*) - 1 AS extra FROM "Ticket" WHERE "eventId" = ${eventId}
         GROUP BY "seatId" HAVING COUNT(*) > 1
       ) e)                                                                               AS duplicate_tickets
  `;

  const totalSeats = await prisma.seat.count({ where: { eventId } });

  const indexRows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'Ticket' AND indexname = 'Ticket_eventId_seatId_key'
    ) AS exists
  `;

  const distinctSeatsSold = Number(rows.distinct_seats);

  return {
    orders: Number(rows.orders),
    tickets: Number(rows.tickets),
    distinctSeatsSold,
    oversoldSeats: Number(rows.oversold_seats),
    duplicateTickets: Number(rows.duplicate_tickets),
    // Selling more distinct seats than the venue has would be a different and
    // even worse failure than selling one seat twice.
    seatsOverCapacity: Math.max(0, distinctSeatsSold - totalSeats),
    uniqueIndexPresent: Boolean(indexRows[0]?.exists),
  };
}

export function connect() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgresql://fairqueue:fairqueue@localhost:5432/fairqueue?schema=public';
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  return { prisma, redis };
}
