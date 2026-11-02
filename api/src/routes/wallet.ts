import { Router, Request, Response } from 'express';
import { EventStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { isTerminal } from '../events/lifecycle';
import { labelFor } from '../events/registry';

export const walletRouter = Router();

/** Transferring is a deliberate act, so the limit is tight. */
const transferLimit = rateLimit('transfer', { perUser: 10 });

/**
 * Everything a reader is told about a ticket.
 *
 * `simulated` is on every single one without exception, because every one of
 * them is. A FairQueue ticket admits nobody to anything, and the moment this
 * API starts handing out things that look like tickets for real events, that
 * has to be impossible to miss.
 */
function formatTicket(ticket: {
  id: string;
  eventId: string;
  ownerId: string;
  createdAt: Date;
  order: { id: string; userId: string; total: number; createdAt: Date };
  seat: { section: string; row: string; number: number; price: number };
  event: {
    id: string;
    name: string;
    venue: string;
    city: string | null;
    startsAt: Date;
    endsAt: Date;
    status: EventStatus;
    source: string;
    sourceUrl: string | null;
    sourceName: string | null;
  };
  _count?: { transfers: number };
}, viewerId: string) {
  return {
    id: ticket.id,
    seat: {
      section: ticket.seat.section,
      row: ticket.seat.row,
      number: ticket.seat.number,
      price: ticket.seat.price,
    },
    event: {
      id: ticket.event.id,
      name: ticket.event.name,
      venue: ticket.event.venue,
      city: ticket.event.city,
      startsAt: ticket.event.startsAt,
      endsAt: ticket.event.endsAt,
      status: ticket.event.status,
      // Carried through so the wallet can say whether the event itself is real.
      verified: ticket.event.source !== 'SEEDED',
      sourceLabel: labelFor(ticket.event.source as never),
      sourceName: ticket.event.sourceName,
      sourceUrl: ticket.event.sourceUrl,
    },
    order: { id: ticket.order.id, total: ticket.order.total, placedAt: ticket.order.createdAt },
    // True when this ticket reached the viewer by transfer rather than purchase.
    receivedByTransfer: ticket.order.userId !== ticket.ownerId,
    boughtByViewer: ticket.order.userId === viewerId,
    transferCount: ticket._count?.transfers ?? 0,
    /** Over, cancelled, or still ahead. Decides whether it can be transferred. */
    transferable: !isTerminal(ticket.event.status) && ticket.event.endsAt.getTime() > Date.now(),
    /** On every ticket, always. See the comment above. */
    simulated: true,
    issuedAt: ticket.createdAt,
  };
}

const TICKET_INCLUDE = {
  order: { select: { id: true, userId: true, total: true, createdAt: true } },
  seat: { select: { section: true, row: true, number: true, price: true } },
  event: {
    select: {
      id: true, name: true, venue: true, city: true, startsAt: true, endsAt: true,
      status: true, source: true, sourceUrl: true, sourceName: true,
    },
  },
  _count: { select: { transfers: true } },
} as const;

/**
 * Everything this person currently holds.
 *
 * Keyed on ownerId, not on who placed the order — a transferred ticket belongs
 * in the recipient's wallet and must leave the sender's, and reading through
 * the order would get both wrong.
 */
walletRouter.get('/api/wallet', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;

  const tickets = await prisma.ticket.findMany({
    where: { ownerId: user.id },
    include: TICKET_INCLUDE,
    orderBy: [{ event: { startsAt: 'asc' } }, { seat: { number: 'asc' } }],
  });

  const now = Date.now();
  const formatted = tickets.map((t) => formatTicket(t, user.id));

  res.json({
    tickets: formatted,
    // Split rather than made the client's problem, since "do I still have
    // something to go to" is the question a wallet exists to answer.
    upcoming: formatted.filter(
      (t) => new Date(t.event.endsAt).getTime() > now && !isTerminal(t.event.status as EventStatus),
    ).length,
    past: formatted.filter(
      (t) => new Date(t.event.endsAt).getTime() <= now || isTerminal(t.event.status as EventStatus),
    ).length,
  });
});

/** One ticket, with everywhere it has been. */
walletRouter.get('/api/tickets/:ticketId', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;

  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.ticketId },
    include: {
      ...TICKET_INCLUDE,
      transfers: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          createdAt: true,
          from: { select: { email: true } },
          to: { select: { email: true } },
        },
      },
    },
  });

  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  // Visible to whoever holds it, whoever bought it, and admins. A previous
  // owner can see it in their transfer history but not its live detail.
  const mayView =
    ticket.ownerId === user.id || ticket.order.userId === user.id || user.role === 'ADMIN';
  if (!mayView) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  res.json({
    ticket: formatTicket(ticket, user.id),
    /** Purchase, then every transfer, oldest first. */
    timeline: [
      {
        kind: 'purchased' as const,
        at: ticket.order.createdAt,
        actor: null,
      },
      ...ticket.transfers.map((t) => ({
        kind: 'transferred' as const,
        at: t.createdAt,
        actor: { from: t.from.email, to: t.to.email },
      })),
    ],
  });
});

const transferSchema = z.object({
  toEmail: z.string().email(),
});

/**
 * Hand a ticket to somebody else.
 *
 * The interesting part is the guard. Two simultaneous transfers of the same
 * ticket must not both succeed, and a SELECT-then-UPDATE cannot promise that:
 * both would read the same owner and both would write. So the update is
 * conditional on the owner and version it expects to find, and Postgres
 * reports how many rows it changed. Zero means somebody else moved the ticket
 * first, and this attempt loses — no locking, no retry loop, one statement.
 */
walletRouter.post(
  '/api/tickets/:ticketId/transfer',
  requireAuth,
  transferLimit,
  async (req: Request, res: Response) => {
    const user = req.user!;

    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid recipient email is required' });
      return;
    }
    const toEmail = parsed.data.toEmail.toLowerCase();

    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.ticketId },
      select: {
        id: true, ownerId: true, version: true,
        event: { select: { status: true, endsAt: true, name: true } },
      },
    });

    if (!ticket || ticket.ownerId !== user.id) {
      // One answer for "no such ticket" and "not yours", so this cannot be
      // used to discover which ticket ids exist.
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    if (isTerminal(ticket.event.status) || ticket.event.endsAt.getTime() <= Date.now()) {
      res.status(409).json({ error: 'That event is over — its tickets cannot be transferred' });
      return;
    }

    const recipient = await prisma.user.findUnique({
      where: { email: toEmail },
      select: { id: true, email: true },
    });
    if (!recipient) {
      res.status(404).json({ error: 'No FairQueue account with that email address' });
      return;
    }
    if (recipient.id === user.id) {
      res.status(400).json({ error: 'That ticket is already yours' });
      return;
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // The guard. Conditional on the owner and version this request read,
        // so a concurrent transfer that already moved the ticket makes this
        // match nothing.
        const moved = await tx.ticket.updateMany({
          where: { id: ticket.id, ownerId: user.id, version: ticket.version },
          data: { ownerId: recipient.id, version: { increment: 1 } },
        });

        if (moved.count === 0) return null;

        await tx.ticketTransfer.create({
          data: { ticketId: ticket.id, fromUserId: user.id, toUserId: recipient.id },
        });

        return recipient;
      });

      if (!result) {
        res.status(409).json({
          error: 'That ticket was just transferred by someone else',
          code: 'transfer_conflict',
        });
        return;
      }

      res.json({
        transferred: true,
        ticketId: ticket.id,
        to: result.email,
        // Said plainly on the way out, not only in the wallet.
        note: 'FairQueue tickets are simulated and admit nobody to any real event.',
      });
    } catch (err) {
      console.error('[wallet] transfer failed:', (err as Error).message);
      res.status(500).json({ error: 'Could not transfer that ticket' });
    }
  },
);

/**
 * What a scanned FairQueue code resolves to.
 *
 * Public on purpose — a door scanner has no account — but it returns only what
 * a scanner needs, never the holder's address. And it says, unmissably, that
 * the thing being scanned is a demonstration and admits nobody to anything.
 */
walletRouter.get('/api/verify/:ticketId', async (req: Request, res: Response) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.ticketId },
    select: {
      id: true,
      createdAt: true,
      seat: { select: { section: true, row: true, number: true } },
      event: { select: { name: true, venue: true, startsAt: true, endsAt: true, status: true } },
      _count: { select: { transfers: true } },
    },
  });

  if (!ticket) {
    res.status(404).json({
      valid: false,
      reason: 'No such ticket',
      simulated: true,
      admitsToRealEvent: false,
    });
    return;
  }

  const over =
    isTerminal(ticket.event.status) || ticket.event.endsAt.getTime() <= Date.now();

  res.json({
    // "Valid" here means only: this code names a real row in this demo, and the
    // event it belongs to has not finished.
    valid: !over,
    reason: over ? 'That event has already taken place' : null,
    ticket: {
      id: ticket.id,
      seat: ticket.seat,
      event: {
        name: ticket.event.name,
        venue: ticket.event.venue,
        startsAt: ticket.event.startsAt,
      },
      transferCount: ticket._count.transfers,
      issuedAt: ticket.createdAt,
    },
    simulated: true,
    admitsToRealEvent: false,
    note: 'FairQueue is a demonstration. This code is not a ticket to anything.',
  });
});
