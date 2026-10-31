/** Same Redis key layout as the api. Kept in both so neither service guesses. */
export const keys = {
  queue: (eventId: string) => `queue:${eventId}`,
  queueNext: (eventId: string) => `queue:next:${eventId}`,
  queueMember: (eventId: string, userId: string) => `queue:member:${eventId}:${userId}`,
  admitted: (eventId: string) => `admitted:${eventId}`,
  pass: (eventId: string, userId: string) => `pass:${eventId}:${userId}`,
  hold: (eventId: string, seatId: string) => `hold:${eventId}:${seatId}`,
  sold: (eventId: string) => `sold:${eventId}`,
  userSeats: (eventId: string, userId: string) => `userseats:${eventId}:${userId}`,
  stat: (eventId: string, name: string) => `stats:${eventId}:${name}`,
};

/** Channel the worker publishes on; every api pod listens and forwards to its browsers. */
export const BROADCAST_CHANNEL = 'fq:broadcast';

/** Same expiries as the api uses. */
export const TTL = {
  PASS_SECONDS: 10 * 60,
  HOLD_SECONDS: 5 * 60,
};
