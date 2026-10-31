import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';

export const adminRouter = Router();

function requireAdmin(req: Request, res: Response): boolean {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admins only' });
    return false;
  }
  return true;
}

const statusSchema = z.object({ status: z.enum(['LIVE', 'PAUSED']) });

/**
 * Pause or resume a sale.
 *
 * Pausing does not close the queue — it stops the worker admitting anyone,
 * while people keep joining and keep their places. That distinction is the
 * whole point: holding a sale must never cost a buyer the position they have
 * already waited for.
 */
adminRouter.post(
  '/api/admin/events/:eventId/status',
  requireAuth,
  async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;

    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'status must be LIVE or PAUSED' });
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: req.params.eventId },
      select: { id: true, status: true },
    });
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    if (event.status !== 'LIVE' && event.status !== 'PAUSED') {
      res.status(409).json({ error: 'Only a sale that is open can be paused or resumed' });
      return;
    }

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { status: parsed.data.status },
      select: { id: true, status: true },
    });

    res.json({ event: updated });
  },
);
