import { io, type Socket } from 'socket.io-client';

/**
 * One socket for the whole tab. Pages subscribe to the event room they care
 * about, so a seat update for one sale never reaches someone watching another.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
  }
  return socket;
}

/** Join an event room and leave it again on unmount. */
export function subscribeToEvent(eventId: string) {
  const s = getSocket();
  const join = () => s.emit('event:subscribe', eventId);
  join();
  // Re-join after a reconnect, otherwise the new connection is in no room.
  s.on('connect', join);
  return () => {
    s.off('connect', join);
    s.emit('event:unsubscribe', eventId);
  };
}
