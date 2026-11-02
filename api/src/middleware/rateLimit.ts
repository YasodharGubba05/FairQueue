import { Request, Response, NextFunction } from 'express';
import { redis } from '../redis';
import { keys } from '../keys';
import { env } from '../env';
import { RATE_LIMIT_LUA } from '../lua/rateLimit';
import { bumpStat, STAT } from '../stats';

export type RateLimitOptions = {
  /** Requests one account may make in the window. */
  perUser: number;
  /** Requests one address may make in the window, as a multiple of perUser. */
  ipMultiplier?: number;
  windowSeconds?: number;
  /**
   * How to identify the caller when nobody is signed in yet.
   *
   * Without this, every anonymous request shares one counter, which turns the
   * limiter into a denial of service: one client hammering /login exhausts the
   * bucket and nobody else can sign in at all. Sign-in therefore keys on the
   * address being attempted, so guessing at one account cannot lock out
   * another.
   */
  identify?: (req: Request) => string | null;
};

const DEFAULT_WINDOW_SECONDS = 10;

/**
 * Turn away anyone hammering a write endpoint.
 *
 * The per-account limit is the one that matters: a queue place belongs to an
 * account, so a bot that wants more throughput has to bring more accounts, and
 * each of those still has to wait its turn in line.
 *
 * The per-address limit is deliberately generous and scaled by RATE_LIMIT_IP_FACTOR.
 * Offices, universities and mobile networks put thousands of real people behind
 * one address, so a tight IP limit locks out genuine buyers while barely
 * inconveniencing anyone with a proxy pool. Load tests drive everything from a
 * single host, which is the same shape of problem, so the factor is raised for
 * benchmark runs rather than the limit being quietly switched off.
 */
export function rateLimit(bucket: string, options: RateLimitOptions) {
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const perUser = options.perUser;
  const perIp = perUser * (options.ipMultiplier ?? env.RATE_LIMIT_IP_FACTOR);

  return async function limit(req: Request, res: Response, next: NextFunction) {
    if (!env.RATE_LIMIT_ENABLED) {
      next();
      return;
    }

    const ip = req.ip ?? 'unknown';
    // Signed in: the account. Not signed in: whatever the route can tell
    // callers apart by, and the address as a last resort. Never a shared
    // constant — see `identify` above for why.
    const userId = req.user?.id ?? options.identify?.(req) ?? `ip:${ip}`;
    // The window is part of the key, so an old counter simply ages out.
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const scoped = `${bucket}:${window}`;

    try {
      const [blocked, scope] = (await redis.eval(
        RATE_LIMIT_LUA,
        2,
        keys.rateUser(userId, scoped),
        keys.rateIp(ip, scoped),
        String(perUser),
        String(perIp),
        String(windowSeconds),
      )) as [number, string];

      if (blocked === 1) {
        const eventId = req.params.eventId;
        if (eventId) bumpStat(eventId, STAT.BLOCKED);
        res.setHeader('Retry-After', String(windowSeconds));
        res.status(429).json({
          error: 'Too many requests — slow down and try again in a moment',
          scope,
        });
        return;
      }
    } catch {
      // If Redis is unreachable the limiter opens rather than closes: losing
      // the sale entirely is worse than losing the limiter for a moment.
    }

    next();
  };
}
