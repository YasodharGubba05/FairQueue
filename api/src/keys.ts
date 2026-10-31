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
  // Seat hold -> userId, 5 minute expiry.
  hold: (eventId: string, seatId: string) => `hold:${eventId}:${seatId}`,
  // Set of sold seat ids for this event.
  sold: (eventId: string) => `sold:${eventId}`,
  // How many seats a user currently holds or owns for this event.
  userSeats: (eventId: string, userId: string) => `userseats:${eventId}:${userId}`,
  // Rate limit counters.
  rateUser: (userId: string, bucket: string) => `rate:user:${userId}:${bucket}`,
  rateIp: (ip: string, bucket: string) => `rate:ip:${ip}:${bucket}`,
  // Pod heartbeat, 10s expiry. Mission Control counts these to show live pods.
  pod: (podName: string) => `pods:api:${podName}`,
  podPattern: 'pods:api:*',
  // Mission Control counters.
  stat: (eventId: string, name: string) => `stats:${eventId}:${name}`,
};

/** Channel the worker publishes on; every api pod listens and forwards to its browsers. */
export const BROADCAST_CHANNEL = 'fq:broadcast';

export const TTL = {
  PASS_SECONDS: 10 * 60,
  HOLD_SECONDS: 5 * 60,
  POD_HEARTBEAT_SECONDS: 10,
};
