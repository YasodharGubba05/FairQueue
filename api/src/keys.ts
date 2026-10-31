/**
 * Every Redis key the system uses, in one place, so the shape of the shared
 * state is readable at a glance.
 */
export const keys = {
  // Sorted set of userId scored by join number.
  queue: (eventId: string) => `queue:${eventId}`,
  // Counter handing out the next join number.
  queueNext: (eventId: string) => `queue:next:${eventId}`,
  // The join number a user already holds (so re-joining is idempotent).
  queueMember: (eventId: string, userId: string) => `queue:member:${eventId}:${userId}`,
  // How many queue positions have been let in so far.
  admitted: (eventId: string) => `admitted:${eventId}`,
  // Admission pass, 10 minute expiry.
  pass: (eventId: string, userId: string) => `pass:${eventId}:${userId}`,
  // Seat hold -> userId. This key IS the lock: if everything else fails, it
  // still expires on its own and the seat comes back.
  hold: (eventId: string, seatId: string) => `hold:${eventId}:${seatId}`,
  // Index of live holds: seatId scored by the ms it expires at. The lock above
  // cannot be listed or watched, so this is how the worker finds what to
  // release and how a seat map reads "which seats are held right now".
  holds: (eventId: string) => `holds:${eventId}`,
  // Set of sold seat ids for this event.
  sold: (eventId: string) => `sold:${eventId}`,
  // Set of seat ids a user currently holds or owns, for the per-user cap.
  userSeats: (eventId: string, userId: string) => `userseats:${eventId}:${userId}`,
  // Rate limit counters.
  rateUser: (userId: string, bucket: string) => `rate:user:${userId}:${bucket}`,
  rateIp: (ip: string, bucket: string) => `rate:ip:${ip}:${bucket}`,
  // Live api pods: podName scored by the ms it last checked in. Mission Control
  // counts the ones inside the heartbeat window.
  //
  // One key per pod with a TTL would read more naturally, but counting those
  // means matching a key pattern, and Redis walks the whole keyspace to do it —
  // hundreds of thousands of keys during a sale, four times a second, to count
  // about three pods. A sorted set answers the same question in a log-time
  // range count, and the worker drops pods that stop checking in.
  pods: 'pods:api',
  // Mission Control counters.
  stat: (eventId: string, name: string) => `stats:${eventId}:${name}`,
};

/** Channel the worker publishes on; every api pod listens and forwards to its browsers. */
export const BROADCAST_CHANNEL = 'fq:broadcast';

export const TTL = {
  PASS_SECONDS: 10 * 60,
  HOLD_SECONDS: 5 * 60,
  POD_HEARTBEAT_SECONDS: 10,
  // The lock key outlives the logical hold by this much, so the worker always
  // still sees who held a seat when it comes to release it. If the worker is
  // down for longer than the grace period, Redis expires the lock anyway and
  // the seat is still freed — late, but never stuck.
  HOLD_GRACE_SECONDS: 60,
  // A user's seat set is only used for the per-user cap during one sale.
  USER_SEATS_SECONDS: 60 * 60,
};
