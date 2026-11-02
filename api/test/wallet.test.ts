import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.MODE = 'fairqueue';
  process.env.RATE_LIMIT_ENABLED = 'false';
  delete process.env.TICKETMASTER_API_KEY;
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { EventStatus } from '@prisma/client';
import { app } from '../src/index';
import { prisma } from '../src/db';
import { redis } from '../src/redis';
import { signAccessToken } from '../src/auth/tokens';
import { stopSeatUpdates } from '../src/seatUpdates';
import { defaultEndsAt } from '../src/events/lifecycle';

const EVENT_ID = 'evt_wallet_test';
const ALICE = 'usr_wallet_alice';
const BOB = 'usr_wallet_bob';
const CAROL = 'usr_wallet_carol';
const EMAIL = (id: string) => `${id}@wallet.test`;
const HOUR = 60 * 60 * 1000;

const tokenFor = (id: string, role: 'BUYER' | 'ADMIN' = 'BUYER') =>
  signAccessToken({ id, email: EMAIL(id), role });

describe('Phase P9 — ticket wallet and transfers', () => {
  let server: http.Server;
  let baseUrl: string;

  async function wipe() {
    await prisma.ticketTransfer.deleteMany({
      where: { ticket: { eventId: EVENT_ID } },
    });
    await prisma.ticket.deleteMany({ where: { eventId: EVENT_ID } });
    await prisma.order.deleteMany({ where: { eventId: EVENT_ID } });
  }

  /** A purchased ticket held by `ownerId`, bought by `buyerId`. */
  async function giveTicket(buyerId: string, seatNumber: number, ownerId = buyerId) {
    const seat = await prisma.seat.upsert({
      where: { id: `s_${EVENT_ID}_A${seatNumber}` },
      update: {},
      create: {
        id: `s_${EVENT_ID}_A${seatNumber}`,
        eventId: EVENT_ID,
        section: 'Floor',
        row: 'A',
        number: seatNumber,
        price: 5000,
        x: seatNumber * 12,
        y: 0,
      },
    });
    const order = await prisma.order.create({
      data: { userId: buyerId, eventId: EVENT_ID, total: seat.price },
    });
    return prisma.ticket.create({
      data: { orderId: order.id, eventId: EVENT_ID, seatId: seat.id, ownerId },
    });
  }

  beforeAll(async () => {
    const startsAt = new Date(Date.now() + 48 * HOUR);
    await prisma.event.upsert({
      where: { id: EVENT_ID },
      update: { status: EventStatus.LIVE, endsAt: defaultEndsAt(startsAt) },
      create: {
        id: EVENT_ID,
        name: 'Wallet Test Event',
        venue: 'Wallet Arena',
        city: 'Testville',
        startsAt,
        endsAt: defaultEndsAt(startsAt),
        saleOpensAt: new Date(Date.now() - HOUR),
        status: EventStatus.LIVE,
        admitPerSec: 100,
        maxSeatsPerUser: 4,
      },
    });

    await prisma.user.createMany({
      data: [ALICE, BOB, CAROL].map((id) => ({
        id,
        email: EMAIL(id),
        passwordHash: 'x',
        emailVerified: true,
      })),
      skipDuplicates: true,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    stopSeatUpdates();
    await wipe();
    await prisma.seat.deleteMany({ where: { eventId: EVENT_ID } });
    await prisma.event.delete({ where: { id: EVENT_ID } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [ALICE, BOB, CAROL] } } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    await redis.quit();
  });

  beforeEach(wipe);

  const wallet = (userId: string) =>
    fetch(`${baseUrl}/api/wallet`, { headers: { Authorization: `Bearer ${tokenFor(userId)}` } });

  const transfer = (userId: string, ticketId: string, toEmail: string) =>
    fetch(`${baseUrl}/api/tickets/${ticketId}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(userId)}` },
      body: JSON.stringify({ toEmail }),
    });

  describe('the wallet', () => {
    it('lists what you hold, not what you bought', async () => {
      await giveTicket(ALICE, 1);
      // Bought by Alice, now held by Bob — the shape a transfer leaves behind.
      await giveTicket(ALICE, 2, BOB);

      const alice = await (await wallet(ALICE)).json();
      const bob = await (await wallet(BOB)).json();

      expect(alice.tickets).toHaveLength(1);
      expect(bob.tickets).toHaveLength(1);
      // Bob sees it arrived by transfer rather than purchase.
      expect(bob.tickets[0].receivedByTransfer).toBe(true);
      expect(bob.tickets[0].boughtByViewer).toBe(false);
    });

    it('marks every ticket simulated, without exception', async () => {
      await giveTicket(ALICE, 3);
      const body = await (await wallet(ALICE)).json();
      expect(body.tickets.every((t: { simulated: boolean }) => t.simulated)).toBe(true);
    });

    it('needs a signed-in user', async () => {
      expect((await fetch(`${baseUrl}/api/wallet`)).status).toBe(401);
    });
  });

  describe('transferring a ticket', () => {
    it('moves it to the recipient and out of the sender wallet', async () => {
      const ticket = await giveTicket(ALICE, 4);

      const res = await transfer(ALICE, ticket.id, EMAIL(BOB));
      expect(res.status).toBe(200);
      expect((await res.json()).transferred).toBe(true);

      expect((await (await wallet(ALICE)).json()).tickets).toHaveLength(0);
      expect((await (await wallet(BOB)).json()).tickets).toHaveLength(1);
    });

    it('records the transfer in an append-only trail', async () => {
      const ticket = await giveTicket(ALICE, 5);
      await transfer(ALICE, ticket.id, EMAIL(BOB));
      await transfer(BOB, ticket.id, EMAIL(CAROL));

      const trail = await prisma.ticketTransfer.findMany({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(trail).toHaveLength(2);
      expect(trail[0].fromUserId).toBe(ALICE);
      expect(trail[1].toUserId).toBe(CAROL);
    });

    it('lets exactly one of two simultaneous transfers win', async () => {
      // The guard. Both requests read the same owner and version; only one
      // update can match, and the other must be told it lost rather than
      // silently overwriting.
      const ticket = await giveTicket(ALICE, 6);

      const [a, b] = await Promise.all([
        transfer(ALICE, ticket.id, EMAIL(BOB)),
        transfer(ALICE, ticket.id, EMAIL(CAROL)),
      ]);

      // Exactly one wins. The loser is refused with either 409 or 404, and
      // which one depends only on when it read the ticket: before the winner
      // committed it reaches the conditional update and is told it conflicted;
      // after, it fails the ownership check first. Both are correct, and the
      // 404 is deliberate — telling a non-owner "that ticket exists but is not
      // yours" would leak which ticket ids are real.
      const statuses = [a.status, b.status].sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409 || s === 404)).toHaveLength(1);

      // And the ticket went to exactly one of them.
      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect([BOB, CAROL]).toContain(after.ownerId);
      expect(after.version).toBe(1);

      // One transfer recorded, not two.
      expect(await prisma.ticketTransfer.count({ where: { ticketId: ticket.id } })).toBe(1);
    });

    it('survives twenty simultaneous transfers of one ticket', async () => {
      // Two requests can race by luck. Twenty cannot all be luck, and this is
      // the shape a retry storm or a double-clicked button actually makes.
      const ticket = await giveTicket(ALICE, 20);

      const attempts = await Promise.all(
        Array.from({ length: 20 }, () => transfer(ALICE, ticket.id, EMAIL(BOB))),
      );

      const won = attempts.filter((r) => r.status === 200);
      expect(won).toHaveLength(1);
      // Everyone else was refused, and nobody got a 500.
      expect(attempts.every((r) => r.status === 200 || r.status === 404 || r.status === 409)).toBe(
        true,
      );

      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(after.ownerId).toBe(BOB);
      // Moved exactly once, however many requests arrived.
      expect(after.version).toBe(1);
      expect(await prisma.ticketTransfer.count({ where: { ticketId: ticket.id } })).toBe(1);
    });

    it('refuses to transfer the same ticket twice', async () => {
      const ticket = await giveTicket(ALICE, 7);
      expect((await transfer(ALICE, ticket.id, EMAIL(BOB))).status).toBe(200);

      // Alice no longer holds it, so a replay is not hers to make.
      const replay = await transfer(ALICE, ticket.id, EMAIL(CAROL));
      expect(replay.status).toBe(404);
      expect(await prisma.ticketTransfer.count({ where: { ticketId: ticket.id } })).toBe(1);
    });

    it('refuses to transfer somebody else’s ticket', async () => {
      const ticket = await giveTicket(ALICE, 8);
      const res = await transfer(BOB, ticket.id, EMAIL(CAROL));
      // 404, not 403: the answer must not reveal that the ticket exists.
      expect(res.status).toBe(404);
      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(after.ownerId).toBe(ALICE);
    });

    it('refuses a transfer to yourself', async () => {
      const ticket = await giveTicket(ALICE, 9);
      expect((await transfer(ALICE, ticket.id, EMAIL(ALICE))).status).toBe(400);
    });

    it('refuses a recipient with no account', async () => {
      const ticket = await giveTicket(ALICE, 10);
      expect((await transfer(ALICE, ticket.id, 'nobody@nowhere.test')).status).toBe(404);
    });

    it('refuses to transfer a ticket for an event that is over', async () => {
      const ticket = await giveTicket(ALICE, 11);
      await prisma.event.update({
        where: { id: EVENT_ID },
        data: { endsAt: new Date(Date.now() - HOUR), status: EventStatus.COMPLETED },
      });

      const res = await transfer(ALICE, ticket.id, EMAIL(BOB));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain('over');

      const startsAt = new Date(Date.now() + 48 * HOUR);
      await prisma.event.update({
        where: { id: EVENT_ID },
        data: { endsAt: defaultEndsAt(startsAt), status: EventStatus.LIVE },
      });
    });
  });

  describe('ticket detail and timeline', () => {
    it('shows the purchase then every transfer, oldest first', async () => {
      const ticket = await giveTicket(ALICE, 12);
      await transfer(ALICE, ticket.id, EMAIL(BOB));

      const res = await fetch(`${baseUrl}/api/tickets/${ticket.id}`, {
        headers: { Authorization: `Bearer ${tokenFor(BOB)}` },
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.timeline[0].kind).toBe('purchased');
      expect(body.timeline[1].kind).toBe('transferred');
      expect(body.timeline[1].actor.to).toBe(EMAIL(BOB));
    });

    it('hides a ticket from somebody with no claim on it', async () => {
      const ticket = await giveTicket(ALICE, 13);
      const res = await fetch(`${baseUrl}/api/tickets/${ticket.id}`, {
        headers: { Authorization: `Bearer ${tokenFor(CAROL)}` },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('verification', () => {
    it('resolves a code and says plainly that it admits nobody', async () => {
      const ticket = await giveTicket(ALICE, 14);
      const res = await fetch(`${baseUrl}/api/verify/${ticket.id}`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(true);
      expect(body.simulated).toBe(true);
      // The claim that must never be absent from this response.
      expect(body.admitsToRealEvent).toBe(false);
      // And never the holder's identity.
      expect(JSON.stringify(body)).not.toContain(EMAIL(ALICE));
    });

    it('reports an unknown code as invalid, still labelled simulated', async () => {
      const res = await fetch(`${baseUrl}/api/verify/does-not-exist`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.valid).toBe(false);
      expect(body.admitsToRealEvent).toBe(false);
    });
  });
});
