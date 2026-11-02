import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { keys } from './keys';

/**
 * How fast each section of the venue is being taken.
 *
 * The counts themselves are not computed here on purpose. Every browser
 * watching a sale already holds the full seat list with live statuses, kept
 * current by the existing 250 ms seat broadcast — so it can derive "how many
 * seats are left in the Floor" itself, and a number computed twice is a number
 * that can disagree with itself.
 *
 * What a browser cannot work out is the rate: it only knows what has happened
 * since it loaded, and a figure that resets on reload is no use for saying
 * which section is moving fastest. So this computes the one thing that has to
 * be server-side and shared, from the change between ticks — the same trick
 * the Mission Control rates use, and no new Redis keys.
 */
type Snapshot = { claimed: Map<string, number>; at: number };

const previous = new Map<string, Snapshot>();

/**
 * Which section each seat belongs to.
 *
 * A venue's layout does not change during a sale, so this is read once per
 * event and kept. Re-reading two thousand rows every second to answer a
 * question whose answer never changes would be absurd.
 */
const sectionBySeat = new Map<string, Map<string, string>>();

async function seatSections(
  prisma: PrismaClient,
  eventId: string,
): Promise<Map<string, string>> {
  const cached = sectionBySeat.get(eventId);
  if (cached) return cached;

  const seats = await prisma.seat.findMany({
    where: { eventId },
    select: { id: true, section: true },
  });

  const map = new Map(seats.map((s) => [s.id, s.section]));
  sectionBySeat.set(eventId, map);
  return map;
}

/** Forget a venue's layout, for when an event's seats are regenerated. */
export function forgetLayout(eventId: string) {
  sectionBySeat.delete(eventId);
  previous.delete(eventId);
}

export type SectionDemand = {
  section: string;
  /** Seats claimed per second in this section, over the last tick. */
  claimRate: number;
  /** Sold plus currently held, as of this tick. */
  claimed: number;
};

/**
 * Read the live sale state and work out per-section movement.
 *
 * Both sources are the ones the booking path already writes: the sold set and
 * the live-hold index. Nothing here maintains its own view of inventory.
 */
export async function buildDemand(
  redis: Redis,
  prisma: PrismaClient,
  eventId: string,
): Promise<{ sections: SectionDemand[]; totalClaimRate: number }> {
  const sections = await seatSections(prisma, eventId);
  if (sections.size === 0) return { sections: [], totalClaimRate: 0 };

  const now = Date.now();
  const [sold, held] = await Promise.all([
    redis.smembers(keys.sold(eventId)),
    // Only holds that have not lapsed; the index is scored by expiry.
    redis.zrangebyscore(keys.holds(eventId), now, '+inf'),
  ]);

  const claimed = new Map<string, number>();
  for (const seatId of [...sold, ...held]) {
    const section = sections.get(seatId);
    if (!section) continue;
    claimed.set(section, (claimed.get(section) ?? 0) + 1);
  }

  const before = previous.get(eventId);
  const seconds = before ? (now - before.at) / 1000 : 0;

  const result: SectionDemand[] = [...claimed.entries()]
    .map(([section, count]) => {
      const was = before?.claimed.get(section) ?? count;
      return {
        section,
        claimed: count,
        // Negative when holds lapse and seats go back on sale, which is not
        // demand — clamp it, rather than showing a section as un-selling.
        claimRate: seconds > 0 ? Math.max(0, Math.round(((count - was) / seconds) * 10) / 10) : 0,
      };
    })
    .sort((a, b) => b.claimRate - a.claimRate || b.claimed - a.claimed);

  previous.set(eventId, { claimed, at: now });

  return {
    sections: result,
    totalClaimRate: Math.round(result.reduce((sum, s) => sum + s.claimRate, 0) * 10) / 10,
  };
}
