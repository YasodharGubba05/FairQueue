import { prisma } from '../db';
import { redis } from '../redis';
import { env } from '../env';
import { syncEvents } from './ingest';

/**
 * The scheduled sync.
 *
 * It runs on the api rather than the worker because the api owns the provider
 * credentials and the adapter code, and because the worker's image carries
 * neither. But the api is the one thing here that scales — the HPA runs up to
 * eight copies — so without a guard every pod would call the provider on every
 * interval and burn the rate limit eight times over for one set of results.
 *
 * So a pod has to win a lock before it syncs. SET NX with the interval as its
 * expiry means exactly one pod syncs per interval and the key clears itself
 * afterwards, with no cleanup to get wrong and nothing to coordinate.
 */
const LOCK_KEY = 'events:sync:lock';

let timer: NodeJS.Timeout | null = null;

async function runIfWeWinTheLock() {
  const intervalSeconds = env.EVENT_SYNC_INTERVAL_MINUTES * 60;

  try {
    // Expire a little before the next tick, so a pod that is slightly early
    // cannot find the lock still held and skip the window entirely.
    const won = await redis.set(
      LOCK_KEY,
      env.POD_NAME,
      'EX',
      Math.max(30, intervalSeconds - 30),
      'NX',
    );
    if (won !== 'OK') return;

    const report = await syncEvents(prisma, {
      countryCode: env.EVENT_SYNC_COUNTRY,
      limit: env.EVENT_SYNC_LIMIT,
    classification: env.EVENT_SYNC_CLASSIFICATION,
    });

    const { created, updated } = report.totals;
    if (created > 0 || updated > 0) {
      console.log(`[events] sync: ${created} created, ${updated} refreshed`);
    }
  } catch (err) {
    // A failed sync is never an outage: the events already in the database are
    // exactly where they were, and the next interval tries again.
    console.warn('[events] sync failed:', (err as Error).message);
  }
}

export function startEventSync() {
  if (env.EVENT_SYNC_INTERVAL_MINUTES <= 0) return;

  // One attempt shortly after boot, so a fresh deployment does not sit empty
  // for hours, and late enough that it is not competing with startup.
  const first = setTimeout(() => void runIfWeWinTheLock(), 10_000);
  timer = setInterval(() => void runIfWeWinTheLock(), env.EVENT_SYNC_INTERVAL_MINUTES * 60_000);

  return () => {
    clearTimeout(first);
    if (timer) clearInterval(timer);
    timer = null;
  };
}

export function stopEventSync() {
  if (timer) clearInterval(timer);
  timer = null;
}
