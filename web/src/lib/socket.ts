import { io, type Socket } from 'socket.io-client';

/**
 * One socket for the whole tab. Pages subscribe to the event room they care
 * about, so a seat update for one sale never reaches someone watching another.
 */
let socket: Socket | null = null;

/**
 * Where the websocket connects.
 *
 * In development and in Docker the page and the api share an origin, so this
 * is empty and the socket connects back to the page. In the hosted deployment
 * the api is behind a Vercel rewrite for HTTP — but a rewrite does not carry a
 * websocket upgrade, so the socket has to go straight to the api's own origin.
 *
 * That connection is cross-origin and carries no cookie, which is fine: event
 * rooms are public, and the per-user notification room is joined by presenting
 * the access token over the socket rather than relying on one.
 */
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? '';

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
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
