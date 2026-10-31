import { PrismaClient, EventStatus } from '@prisma/client';
import Redis from 'ioredis';
import { env } from './env';
import { keys, BROADCAST_CHANNEL, TTL } from './keys';
import { ADMIT_LUA } from './lua/admit';

/**
 * The worker is the one process that is allowed to move the line forward.
 * Every tick it:
 *   - admits `admitPerSec` users per event in join order and issues passes
 *   - broadcasts one "admitted" number per event to every browser
 *   - releases seat holds that have expired                            (P3)
 *
 * Only one replica runs, so there is never a second process handing out passes.
 */
const prisma = new PrismaClient();
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

let running = true;

/** Events the worker has to service: a sale that is open or paused. */
async function loadActiveEvents() {
  return prisma.event.findMany({
    where: { status: { in: [EventStatus.LIVE, EventStatus.PAUSED] } },
    select: { id: true, status: true, admitPerSec: true, maxSeatsPerUser: true },
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

async function tick() {
  const events = await loadActiveEvents();
  if (events.length === 0) return;

  for (const event of events) {
    const { admitted, joined, admittedNow } = await admit(event);

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
