import Redis from 'ioredis';
import { env } from './env';
import { BROADCAST_CHANNEL } from './keys';
import { getIo, eventRoom } from './io';

/**
 * The worker is the only process that knows how far the line has moved, but the
 * browsers are connected to the api pods. So the worker publishes one message
 * per event per second on a Redis channel, and every api pod forwards it to the
 * browsers watching that event.
 *
 * One message for everyone, not one per waiting user: the browser already knows
 * its own join number, so "admitted" is all it needs to work out its position.
 */
export function startBroadcastBridge() {
  const sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  sub.subscribe(BROADCAST_CHANNEL).catch((err) => {
    console.error('[api] broadcast subscribe failed:', (err as Error).message);
  });

  sub.on('message', (_channel, raw) => {
    const io = getIo();
    if (!io) return;
    try {
      const msg = JSON.parse(raw) as { type?: string; eventId?: string };
      if (!msg.eventId) return;
      if (msg.type === 'queue') io.to(eventRoom(msg.eventId)).emit('queue:tick', msg);
      if (msg.type === 'seats') io.to(eventRoom(msg.eventId)).emit('seats:update', msg);
      if (msg.type === 'stats') io.to(eventRoom(msg.eventId)).emit('stats:tick', msg);
    } catch {
      // A malformed message is not worth crashing a pod over.
    }
  });

  return sub;
}
