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
