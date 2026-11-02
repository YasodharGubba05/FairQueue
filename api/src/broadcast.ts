import Redis from 'ioredis';
import { env } from './env';
import { BROADCAST_CHANNEL } from './keys';
import { getIo, eventRoom, userRoom } from './io';

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
      const msg = JSON.parse(raw) as {
        type?: string;
        eventId?: string;
        userIds?: string[];
        notification?: unknown;
      };

      // Notifications are addressed to people, not to an event, so they are
      // handled before the eventId check below.
      if (msg.type === 'notify' && Array.isArray(msg.userIds)) {
        for (const userId of msg.userIds) {
          io.to(userRoom(userId)).emit('notification', msg.notification);
        }
        return;
      }

      if (!msg.eventId) return;
      if (msg.type === 'queue') io.to(eventRoom(msg.eventId)).emit('queue:tick', msg);
      if (msg.type === 'seats') io.to(eventRoom(msg.eventId)).emit('seats:update', msg);
      if (msg.type === 'stats') io.to(eventRoom(msg.eventId)).emit('stats:tick', msg);
      if (msg.type === 'demand') io.to(eventRoom(msg.eventId)).emit('demand:tick', msg);
    } catch {
      // A malformed message is not worth crashing a pod over.
    }
  });

  return sub;
}
