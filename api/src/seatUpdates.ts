import { redis } from './redis';
import { BROADCAST_CHANNEL } from './keys';

/**
 * Seat changes go out in batches, not one message per seat.
 *
 * When 2,000 seats are being grabbed at once, sending a message per seat means
 * thousands of tiny websocket frames a second to every open seat map, and the
 * browser spends all its time re-rendering. Instead each change lands in a
 * buffer and the buffer is flushed every 250 ms: four messages a second per
 * event, however busy the sale gets.
 *
 * The last write for a seat wins, so a seat held and then sold inside the same
 * window goes out once, as sold.
 */
export type SeatStatus = 'available' | 'held' | 'sold';

const FLUSH_MS = 250;

const pending = new Map<string, Map<string, SeatStatus>>();
let timer: NodeJS.Timeout | null = null;

export function queueSeatUpdate(eventId: string, seatIds: string[], status: SeatStatus) {
  let forEvent = pending.get(eventId);
  if (!forEvent) {
    forEvent = new Map();
    pending.set(eventId, forEvent);
  }
  for (const seatId of seatIds) forEvent.set(seatId, status);

  if (timer === null) timer = setTimeout(flush, FLUSH_MS);
}

function flush() {
  timer = null;
  const batches = [...pending.entries()];
  pending.clear();

  for (const [eventId, seats] of batches) {
    if (seats.size === 0) continue;
    // Published rather than emitted directly: the browsers watching this event
    // are spread across every api pod, not just this one.
    redis
      .publish(
        BROADCAST_CHANNEL,
        JSON.stringify({
          type: 'seats',
          eventId,
          seats: [...seats.entries()].map(([id, status]) => ({ id, status })),
        }),
      )
      .catch(() => {
        // A dropped seat update is not fatal: the seat map reloads on navigation
        // and every claim is re-checked in Redis anyway.
      });
  }
}

/** Stop the pending flush so tests and shutdown do not hang on a live timer. */
export function stopSeatUpdates() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}
