import { redis } from './redis';
import { keys } from './keys';

/**
 * Counters Mission Control reads. They are plain Redis integers: the dashboard
 * wants "how many so far", and the per-second rates are worked out by the
 * worker from the change between ticks rather than stored as a time series.
 *
 * None of these is load-bearing — nothing in the sale depends on them — so
 * they are incremented without awaiting and a failed write is swallowed.
 */
export const STAT = {
  // Note: there is no "joined" counter. queue:next:{event} already is the
  // number of people who have taken a place in line.
  HOLDS: 'holds',
  PURCHASES: 'purchases',
  TICKETS: 'tickets',
  /** Requests turned away by the rate limiter. */
  BLOCKED: 'blocked',
  /** Hold or checkout attempts with no admission pass: someone skipping the line. */
  NO_PASS: 'nopass',
} as const;

export type StatName = (typeof STAT)[keyof typeof STAT];

export function bumpStat(eventId: string, name: StatName, by = 1) {
  redis.incrby(keys.stat(eventId, name), by).catch(() => {
    // A dropped counter costs a dashboard tick, never a sale.
  });
}
