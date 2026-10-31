import fs from 'node:fs';
import { PrismaClient, EventStatus } from '@prisma/client';
import Redis from 'ioredis';
import { env } from './env';
import { keys, BROADCAST_CHANNEL, TTL } from './keys';
import { ADMIT_LUA } from './lua/admit';
import { EXPIRE_HOLDS_LUA } from './lua/expire';
import { buildStats, nextTick, prunePods } from './stats';
import { completeFinishedEvents } from './lifecycle';

/**
 * The worker is the one process that is allowed to move the line forward.
 * Every tick it:
 *   - admits `admitPerSec` users per event in join order and issues passes
 *   - broadcasts one "admitted" number per event to every browser
 *   - releases seat holds that have expired and tells every browser
 *   - broadcasts one Mission Control reading per event per second
 *   - retires events once they are over
 *
 * Only one replica runs, so there is never a second process handing out passes.
 */
const prisma = new PrismaClient();
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

let running = true;

/**
 * The worker has no port to probe, and "the process is running" is not the
 * question worth asking: a tick loop stuck waiting on a dead connection keeps
 * the process alive while the queue silently stops moving. So each completed
 * tick touches this file, and Kubernetes checks how old it is. A worker that
 * has stopped ticking gets restarted; one that is merely idle does not.
 */
const HEARTBEAT_FILE = env.HEARTBEAT_FILE;

function markTickComplete() {
  try {
    fs.writeFileSync(HEARTBEAT_FILE, String(Date.now()));
  } catch {
    // A missing heartbeat file is a probe problem, not a reason to stop work.
  }
}

/** Events the worker has to service: a sale that is open or paused. */
async function loadActiveEvents() {
  return prisma.event.findMany({
    where: { status: { in: [EventStatus.LIVE, EventStatus.PAUSED] } },
    select: {
      id: true,
      status: true,
      admitPerSec: true,
      maxSeatsPerUser: true,
      // The seat count never changes during a sale, so it comes along with the
      // event rather than being counted again every second.
      _count: { select: { seats: true } },
    },
  });
}

type ActiveEvent = Awaited<ReturnType<typeof loadActiveEvents>>[number];

/**
 * Move the watermark forward for one event and hand the new arrivals a pass.
 * A paused sale admits nobody, but the queue keeps accepting joiners so their
 * places are kept while an admin sorts out whatever made them pause.
 */
async function admit(event: ActiveEvent) {
  const batch = event.status === EventStatus.PAUSED ? 0 : event.admitPerSec;

  const [admitted, joined, admittedNow] = (await redis.eval(
    ADMIT_LUA,
    3,
    keys.admitted(event.id),
    keys.queueNext(event.id),
    keys.queue(event.id),
    event.id,
    String(batch),
    String(TTL.PASS_SECONDS),
  )) as [number, number, number];

  return { admitted, joined, admittedNow };
}

/**
 * Release holds whose five minutes are up. The limit keeps one tick bounded so
 * a big backlog is cleared over several ticks rather than stalling Redis.
 */
const EXPIRE_LIMIT = 500;

async function releaseExpiredHolds(eventId: string) {
  const released = (await redis.eval(
    EXPIRE_HOLDS_LUA,
    1,
    keys.holds(eventId),
    eventId,
    String(Date.now()),
    String(EXPIRE_LIMIT),
  )) as string[];

  if (released.length === 0) return released;

  // Those seats are on sale again, so every open seat map has to know.
  await redis.publish(
    BROADCAST_CHANNEL,
    JSON.stringify({
      type: 'seats',
      eventId,
      seats: released.map((id) => ({ id, status: 'available' })),
    }),
  );

  return released;
}

async function tick() {
  nextTick();
  await prunePods(redis);
  await completeFinishedEvents(prisma);

  const events = await loadActiveEvents();
  if (events.length === 0) return;

  for (const event of events) {
    const { admitted, joined, admittedNow } = await admit(event);
    await releaseExpiredHolds(event.id);

    // Mission Control's reading for this second.
    const stats = await buildStats(redis, prisma, event, event._count.seats);
    await redis.publish(BROADCAST_CHANNEL, JSON.stringify(stats));

    // One message per event per second, not one per waiting user. Each browser
    // knows its own join number, so `admitted` is all it needs to work out its
    // own position in the line.
    await redis.publish(
      BROADCAST_CHANNEL,
      JSON.stringify({
        type: 'queue',
        eventId: event.id,
        admitted,
        joined,
        admittedNow,
        admitPerSec: event.admitPerSec,
        status: event.status,
        at: Date.now(),
      }),
    );
  }
}

async function loop() {
  while (running) {
    const startedAt = Date.now();
    try {
      await tick();
    } catch (err) {
      // A bad tick must never kill the worker; the next one retries.
      console.error('[worker] tick failed:', (err as Error).message);
    }
    markTickComplete();
    const elapsed = Date.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, env.TICK_MS - elapsed)));
  }
}

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down`);
  running = false;
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

console.log(`[worker] mode=${env.MODE} tick=${env.TICK_MS}ms`);
void loop();
