import { Router } from 'express';
import { prisma } from '../db';
import { redis } from '../redis';
import { env } from '../env';

export const healthRouter = Router();

// Liveness: the process is running. Kubernetes restarts the pod if this fails.
healthRouter.get('/healthz', (_req, res) => {
  res.json({ ok: true, mode: env.MODE, pod: env.POD_NAME });
});

// Readiness: we can actually reach Postgres and Redis. Kubernetes stops sending
// traffic to the pod if this fails, without restarting it.
healthRouter.get('/readyz', async (_req, res) => {
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: (err as Error).message });
  }
});

healthRouter.get('/api/mode', (_req, res) => {
  res.json({ mode: env.MODE });
});
