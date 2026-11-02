import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env, isNaive } from './env';
import { prisma } from './db';
import { redis, createPubSubPair } from './redis';
import { keys, TTL } from './keys';
import { setIo, eventRoom } from './io';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { eventsRouter } from './routes/events';
import { seatsRouter } from './routes/seats';
import { checkoutRouter } from './routes/checkout';
import { queueRouter } from './routes/queue';
import { holdsRouter } from './routes/holds';
import { statsRouter } from './routes/stats';
import { adminRouter } from './routes/admin';
import { walletRouter } from './routes/wallet';
import { startBroadcastBridge } from './broadcast';
import { stopSeatUpdates } from './seatUpdates';
import { startEventSync, stopEventSync } from './events/scheduler';

export const app = express();
app.set('trust proxy', true);
// Credentials are sent as cookies, so the browser's origin has to be named
// explicitly — a wildcard origin cannot carry them.
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: '64kb' }));

// Mount routes
app.use(healthRouter);
app.use(authRouter);
app.use(eventsRouter);
app.use(queueRouter);
app.use(seatsRouter);
app.use(holdsRouter);
app.use(statsRouter);
app.use(adminRouter);
app.use(walletRouter);
app.use(checkoutRouter);

/**
 * Anything a route throws ends up here. Without this, Express answers a bare
 * 500 and the reason is lost, which is exactly when you most want to see it.
 */
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api] unhandled error:', err.stack ?? err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong on our side' });
});

export const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: '*' }, path: '/socket.io' });

// Any api pod may need to push an update to a browser connected to a different
// pod, so all pods share one Socket.io backbone through Redis pub/sub.
const { pub, sub } = createPubSubPair();
io.adapter(createAdapter(pub, sub));
setIo(io);

// Forward the worker's per-second queue broadcast to the browsers on this pod.
const broadcastSub = startBroadcastBridge();

// A browser joins the room for the event it is watching, so a seat update only
// travels to the people looking at that event.
io.on('connection', (socket) => {
  socket.on('event:subscribe', (eventId: unknown) => {
    if (typeof eventId === 'string' && eventId.length > 0) socket.join(eventRoom(eventId));
  });
  socket.on('event:unsubscribe', (eventId: unknown) => {
    if (typeof eventId === 'string' && eventId.length > 0) socket.leave(eventRoom(eventId));
  });
});

// Every pod says it is alive twice inside the heartbeat window, so one missed
// beat never makes a healthy pod vanish from the dashboard.
let heartbeat: NodeJS.Timeout | null = null;

async function setupModeConstraints() {
  try {
    if (isNaive) {
      // In naive mode, drop the UNIQUE constraint so concurrent read-then-write checkouts
      // demonstrate double-selling during load testing.
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Ticket_eventId_seatId_key"`);
    } else {
      // In fairqueue mode, guarantee the unique index as the last line of defense.
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_eventId_seatId_key" ON "Ticket"("eventId", "seatId")`
      );
    }
  } catch (err) {
    console.warn('[api] setupModeConstraints warning:', (err as Error).message);
  }
}

if (process.env.NODE_ENV !== 'test') {
  void setupModeConstraints();

  const beat = () => {
    redis.zadd(keys.pods, Date.now(), env.POD_NAME).catch(() => {});
  };
  beat();
  heartbeat = setInterval(beat, (TTL.POD_HEARTBEAT_SECONDS / 2) * 1000);

  // Refresh live events on a schedule. A no-op when no provider is configured.
  startEventSync();

  server.listen(env.API_PORT, () => {
    console.log(`[api] mode=${env.MODE} pod=${env.POD_NAME} listening on :${env.API_PORT}`);
  });
}

async function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  if (heartbeat) clearInterval(heartbeat);
  stopSeatUpdates();
  stopEventSync();
  // Leave the dashboard immediately on a clean shutdown rather than waiting to
  // time out.
  await redis.zrem(keys.pods, env.POD_NAME).catch(() => {});
  server.close();
  await Promise.allSettled([
    prisma.$disconnect(),
    redis.quit(),
    pub.quit(),
    sub.quit(),
    broadcastSub.quit(),
  ]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
