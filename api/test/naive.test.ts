import { vi } from 'vitest';

// Vitest sets process.env.MODE to 'test', and this suite needs the naive build.
// vi.hoisted runs before the imports below, so src/env.ts reads the right mode.
vi.hoisted(() => {
  process.env.MODE = 'naive';
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { app } from '../src/index';
import { prisma } from '../src/db';
import { signToken } from '../src/middleware/auth';

describe('Phase P1 — Naive Mode & Core Endpoints', () => {
  let server: http.Server;
  let baseUrl: string;

  const buyer1 = { id: 'usr_buyer_0001', email: 'buyer0001@fairqueue.dev', role: 'BUYER' as const };
  const buyer2 = { id: 'usr_buyer_0002', email: 'buyer0002@fairqueue.dev', role: 'BUYER' as const };
  let token1: string;
  let token2: string;

  beforeAll(async () => {
    token1 = signToken(buyer1);
    token2 = signToken(buyer2);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });

    // Clean tickets and orders before tests for repeatability
    await prisma.ticket.deleteMany();
    await prisma.order.deleteMany();

    // In test environment, ensure unique constraint is dropped to simulate naive mode
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Ticket_eventId_seatId_key"`);
  });

  afterAll(async () => {
    // This suite deliberately double-sells, which leaves rows that the UNIQUE
    // index cannot coexist with. Clear them and put the backstop back, so the
    // database is left in the state every other suite — and fairqueue mode on
    // the next boot — expects to find.
    await prisma.ticket.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_eventId_seatId_key" ON "Ticket"("eventId","seatId")`,
    );

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });

  describe('Auth Routes', () => {
    it('logs in successfully with valid seeded credentials', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'buyer0001@fairqueue.dev', password: 'password123' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      // Renamed from `token` when refresh tokens arrived: the body now carries
      // the short-lived access token, and the refresh token is in a cookie.
      expect(data.accessToken).toBeDefined();
      expect(data.expiresIn).toBeGreaterThan(0);
      expect(data.user).toMatchObject({
        email: 'buyer0001@fairqueue.dev',
        role: 'BUYER',
      });
    });

    it('rejects invalid password with 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'buyer0001@fairqueue.dev', password: 'wrongpassword' }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid credentials');
    });

    it('fetches current user via /api/auth/me with Bearer token', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token1}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.email).toBe('buyer0001@fairqueue.dev');
    });

    it('rejects /api/auth/me without authorization header', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      expect(res.status).toBe(401);
    });
  });

  describe('Events Routes', () => {
    it('returns seeded events with seat counts and price ranges', async () => {
      const res = await fetch(`${baseUrl}/api/events`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.events).toBeInstanceOf(Array);
      expect(data.events.length).toBeGreaterThanOrEqual(3);

      const headline = data.events.find((e: { id: string }) => e.id === 'evt_headline');
      expect(headline).toBeDefined();
      expect(headline.totalSeats).toBe(2000);
      expect(headline.minPrice).toBeGreaterThan(0);
      expect(headline.maxPrice).toBeGreaterThanOrEqual(headline.minPrice);
    });

    it('returns details for a single event', async () => {
      const res = await fetch(`${baseUrl}/api/events/evt_headline`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.event.id).toBe('evt_headline');
      expect(data.event.name).toContain('Neon Districts');
    });

    it('returns 404 for unknown event', async () => {
      const res = await fetch(`${baseUrl}/api/events/non_existent`);
      expect(res.status).toBe(404);
    });
  });

  describe('Seats Routes', () => {
    it('returns 2000 seats for headline event with section, row, number, coordinates', async () => {
      const res = await fetch(`${baseUrl}/api/events/evt_headline/seats`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.seats.length).toBe(2000);

      const seat = data.seats[0];
      expect(seat).toHaveProperty('id');
      expect(seat).toHaveProperty('section');
      expect(seat).toHaveProperty('row');
      expect(seat).toHaveProperty('number');
      expect(seat).toHaveProperty('price');
      expect(seat).toHaveProperty('x');
      expect(seat).toHaveProperty('y');
      expect(seat.status).toBe('available');
    });
  });

  describe('Naive Checkout & Concurrency Double-Selling', () => {
    it('allows a buyer to purchase a seat in naive mode', async () => {
      const seat = await prisma.seat.findFirst({
        where: { eventId: 'evt_headline' },
      });
      expect(seat).toBeDefined();

      const res = await fetch(`${baseUrl}/api/events/evt_headline/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token1}`,
        },
        body: JSON.stringify({ seatIds: [seat!.id] }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.orderId).toBeDefined();
      expect(data.tickets.length).toBe(1);

      // Verify order lookup
      const orderRes = await fetch(`${baseUrl}/api/orders/${data.orderId}`, {
        headers: { Authorization: `Bearer ${token1}` },
      });

      expect(orderRes.status).toBe(200);
      const orderData = await orderRes.json();
      expect(orderData.order.tickets[0].seatId).toBe(seat!.id);
    });

    it('demonstrates double-selling when two concurrent requests race for the same seat', async () => {
      // Pick a clean, unsold seat
      const unsoldSeat = await prisma.seat.findFirst({
        where: {
          eventId: 'evt_headline',
          tickets: { none: {} },
        },
      });
      expect(unsoldSeat).toBeDefined();
      const targetSeatId = unsoldSeat!.id;

      // Send two concurrent checkout requests for the exact same seat
      const [resA, resB] = await Promise.all([
        fetch(`${baseUrl}/api/events/evt_headline/checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token1}`,
          },
          body: JSON.stringify({ seatIds: [targetSeatId] }),
        }),
        fetch(`${baseUrl}/api/events/evt_headline/checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token2}`,
          },
          body: JSON.stringify({ seatIds: [targetSeatId] }),
        }),
      ]);

      // Both requests read the seat as available before either wrote the ticket
      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);

      // Verify double-selling directly in the database: 2 tickets for the SAME seat!
      const tickets = await prisma.ticket.findMany({
        where: {
          eventId: 'evt_headline',
          seatId: targetSeatId,
        },
      });

      expect(tickets.length).toBe(2);
      expect(tickets[0].orderId).not.toBe(tickets[1].orderId);
    });
  });
});
