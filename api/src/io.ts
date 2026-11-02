import type { Server } from 'socket.io';

/**
 * The Socket.io server is created in index.ts but routes need to broadcast from
 * anywhere, so it is registered here once at startup.
 */
let server: Server | null = null;

export function setIo(instance: Server) {
  server = instance;
}

export function getIo(): Server | null {
  return server;
}

export const eventRoom = (eventId: string) => `event:${eventId}`;

/**
 * A room of one.
 *
 * Notifications go here rather than to an event room, because who follows what
 * is nobody else's business. A socket only joins its own after proving who it
 * is — see the connection handler in index.ts.
 */
export const userRoom = (userId: string) => `user:${userId}`;
