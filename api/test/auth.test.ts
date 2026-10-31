import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.MODE = 'fairqueue';
  process.env.RATE_LIMIT_ENABLED = 'false';
  delete process.env.TICKETMASTER_API_KEY;
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { app } from '../src/index';
import { prisma } from '../src/db';
import { redis } from '../src/redis';
import { env } from '../src/env';
import { hashPassword } from '../src/password';
import { signAccessToken, rotateRefreshToken, issueRefreshToken, revokeAllForUser } from '../src/auth/tokens';
import { REFRESH_COOKIE } from '../src/auth/cookies';
import { findOrCreateFromGoogle } from '../src/auth/users';
import { stopSeatUpdates } from '../src/seatUpdates';

const PASSWORD_USER = 'usr_auth_pw';
const OAUTH_SUBJECT = 'google-subject-0001';
const EMAIL_PW = 'authpw@test.dev';
const EMAIL_OAUTH = 'authoauth@test.dev';

/** Pull one cookie out of a Set-Cookie header. */
function cookieFrom(res: Response, name: string): string | null {
  const header = res.headers.get('set-cookie');
  if (!header) return null;
  const match = header.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

describe('Phase P8 — authentication', () => {
  let server: http.Server;
  let baseUrl: string;

  async function wipeUsers() {
    const emails = [EMAIL_PW, EMAIL_OAUTH, 'linked@test.dev', 'brandnew@test.dev'];
    const users = await prisma.user.findMany({
      where: { OR: [{ email: { in: emails } }, { id: PASSWORD_USER }] },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    if (ids.length === 0) return;
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.oAuthIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.order.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
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
    await wipeUsers();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    await redis.quit();
  });

  beforeEach(async () => {
    await wipeUsers();
    await prisma.user.create({
      data: {
        id: PASSWORD_USER,
        email: EMAIL_PW,
        passwordHash: hashPassword('correct horse'),
        emailVerified: true,
      },
    });
  });

  const login = (password: string, email = EMAIL_PW) =>
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

  const refresh = (cookie: string | null) =>
    fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: cookie ? { Cookie: `${REFRESH_COOKIE}=${cookie}` } : {},
    });

  describe('password sign-in', () => {
    it('issues a short-lived access token and a refresh cookie', async () => {
      const res = await login('correct horse');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.user.email).toBe(EMAIL_PW);
      // Minutes, not a week: it cannot be revoked, so it must not live long.
      expect(body.expiresIn).toBeLessThanOrEqual(15 * 60);

      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain(REFRESH_COOKIE);
      // The property that makes an XSS unable to steal the session.
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      // Never returned in the body, where script could read it.
      expect(JSON.stringify(body)).not.toContain(cookieFrom(res, REFRESH_COOKIE)!);
    });

    it('rejects a wrong password', async () => {
      expect((await login('wrong')).status).toBe(401);
    });

    it('gives the same answer for an unknown address as for a wrong password', async () => {
      // Otherwise the response tells an attacker which addresses are registered.
      const unknown = await login('anything', 'nobody@test.dev');
      const wrong = await login('wrong');
      expect(unknown.status).toBe(wrong.status);
      expect(await unknown.json()).toEqual(await wrong.json());
    });

    it('refuses to sign in to a provider-only account with any password', async () => {
      // The account has no password hash at all. Verification must fail before
      // it ever reaches the hashing function.
      await prisma.user.create({
        data: { email: EMAIL_OAUTH, passwordHash: null, emailVerified: true },
      });
      for (const attempt of ['x', 'null', 'undefined', 'password123']) {
        expect((await login(attempt, EMAIL_OAUTH)).status).toBe(401);
      }
      // An empty password never reaches the account at all: it is refused as a
      // malformed request, which tells a caller nothing about the account.
      expect((await login('', EMAIL_OAUTH)).status).toBe(400);
    });
  });

  describe('access tokens', () => {
    it('rejects one signed with the wrong secret', async () => {
      const forged = jwt.sign({ id: PASSWORD_USER, email: EMAIL_PW, role: 'ADMIN' }, 'not-the-secret', {
        issuer: env.TOKEN_ISSUER,
        audience: env.TOKEN_AUDIENCE,
      });
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${forged}` },
      });
      expect(res.status).toBe(401);
    });

    it('rejects an expired one', async () => {
      const expired = jwt.sign({ id: PASSWORD_USER, email: EMAIL_PW, role: 'BUYER' }, env.JWT_SECRET, {
        issuer: env.TOKEN_ISSUER,
        audience: env.TOKEN_AUDIENCE,
        expiresIn: -10,
      });
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${expired}` },
      });
      expect(res.status).toBe(401);
    });

    it('rejects one minted for a different audience', async () => {
      const wrongAudience = jwt.sign(
        { id: PASSWORD_USER, email: EMAIL_PW, role: 'BUYER' },
        env.JWT_SECRET,
        { issuer: env.TOKEN_ISSUER, audience: 'some-other-service', expiresIn: 600 },
      );
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${wrongAudience}` },
      });
      expect(res.status).toBe(401);
    });

    it('rejects an unsigned token', async () => {
      // alg=none, the classic. jwt.verify must refuse it.
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ id: PASSWORD_USER, email: EMAIL_PW, role: 'ADMIN' }),
      ).toString('base64url');
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${header}.${payload}.` },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('refresh token rotation', () => {
    it('returns a different token every time and keeps the session alive', async () => {
      const first = cookieFrom(await login('correct horse'), REFRESH_COOKIE);
      const res = await refresh(first);
      expect(res.status).toBe(200);

      const second = cookieFrom(res, REFRESH_COOKIE);
      expect(second).toBeTruthy();
      expect(second).not.toBe(first);
      expect((await res.json()).accessToken).toBeTruthy();
    });

    it('refuses the old token once it has been rotated away', async () => {
      const first = cookieFrom(await login('correct horse'), REFRESH_COOKIE);
      await refresh(first);

      const replay = await refresh(first);
      expect(replay.status).toBe(401);
      expect((await replay.json()).reason).toBe('reused');
    });

    it('kills the whole login chain when a spent token is replayed', async () => {
      // A stolen token and the real one are indistinguishable from here, so
      // both are logged out. An unexpected sign-out beats a silent compromise.
      const first = cookieFrom(await login('correct horse'), REFRESH_COOKIE);
      const second = cookieFrom(await refresh(first), REFRESH_COOKIE);
      const third = cookieFrom(await refresh(second), REFRESH_COOKIE);

      // The thief replays the oldest token.
      expect((await refresh(first)).status).toBe(401);

      // The victim's current token is dead too.
      expect((await refresh(third)).status).toBe(401);

      const live = await prisma.refreshToken.count({
        where: { userId: PASSWORD_USER, revokedAt: null },
      });
      expect(live).toBe(0);
    });

    it('refuses an expired refresh token', async () => {
      const issued = await issueRefreshToken(PASSWORD_USER);
      await prisma.refreshToken.updateMany({
        where: { userId: PASSWORD_USER, revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const result = await rotateRefreshToken(issued.token);
      expect(result).toEqual({ ok: false, reason: 'expired' });
    });

    it('refuses a token that was never issued', async () => {
      expect(await rotateRefreshToken('completely-made-up')).toEqual({
        ok: false,
        reason: 'unknown',
      });
    });

    it('stores only a hash, never the token itself', async () => {
      const token = cookieFrom(await login('correct horse'), REFRESH_COOKIE)!;
      const rows = await prisma.refreshToken.findMany({ where: { userId: PASSWORD_USER } });
      // A database leak must not hand over live sessions.
      expect(rows.every((r) => r.tokenHash !== token)).toBe(true);
      expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('signing out', () => {
    it('revokes the session and clears the cookie', async () => {
      const token = cookieFrom(await login('correct horse'), REFRESH_COOKIE);

      const res = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: `${REFRESH_COOKIE}=${token}` },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('set-cookie') ?? '').toContain(`${REFRESH_COOKIE}=`);

      expect((await refresh(token)).status).toBe(401);
    });

    it('succeeds even with no session, without saying so', async () => {
      expect((await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' })).status).toBe(204);
    });

    it('signs out every device at once', async () => {
      const a = cookieFrom(await login('correct horse'), REFRESH_COOKIE);
      const b = cookieFrom(await login('correct horse'), REFRESH_COOKIE);

      expect(await revokeAllForUser(PASSWORD_USER)).toBe(2);
      expect((await refresh(a)).status).toBe(401);
      expect((await refresh(b)).status).toBe(401);
    });
  });

  describe('linking a Google identity', () => {
    const identity = {
      subject: OAUTH_SUBJECT,
      email: EMAIL_OAUTH,
      emailVerified: true,
      name: 'Test Person',
    };

    it('creates a new account as a BUYER, never an admin', async () => {
      const user = await findOrCreateFromGoogle({ ...identity, email: 'brandnew@test.dev' });
      expect(user.created).toBe(true);
      // Privilege is never something an identity provider hands out.
      expect(user.role).toBe('BUYER');

      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.passwordHash).toBeNull();
      expect(row.emailVerified).toBe(true);
    });

    it('returns the same account on a second sign-in rather than duplicating', async () => {
      const first = await findOrCreateFromGoogle(identity);
      const second = await findOrCreateFromGoogle(identity);

      expect(second.id).toBe(first.id);
      expect(second.created).toBe(false);
      expect(await prisma.user.count({ where: { email: EMAIL_OAUTH } })).toBe(1);
      expect(await prisma.oAuthIdentity.count({ where: { subject: OAUTH_SUBJECT } })).toBe(1);
    });

    it('links to an existing password account with the same verified address', async () => {
      const linked = await findOrCreateFromGoogle({ ...identity, email: EMAIL_PW });

      expect(linked.id).toBe(PASSWORD_USER);
      expect(linked.created).toBe(false);
      expect(linked.linked).toBe(true);
      // Still one account, now reachable two ways.
      expect(await prisma.user.count({ where: { email: EMAIL_PW } })).toBe(1);
    });

    it('refuses an unverified address outright', async () => {
      // Otherwise signing up to Google with somebody else's address would take
      // over their FairQueue account.
      await expect(
        findOrCreateFromGoogle({ ...identity, emailVerified: false, email: EMAIL_PW }),
      ).rejects.toThrow(/unverified/i);
    });

    it('keeps an admin an admin when they later sign in with Google', async () => {
      await prisma.user.update({ where: { id: PASSWORD_USER }, data: { role: 'ADMIN' } });
      const linked = await findOrCreateFromGoogle({ ...identity, email: EMAIL_PW });
      // The role comes from our database, not from the provider.
      expect(linked.role).toBe('ADMIN');
    });
  });

  describe('role enforcement', () => {
    it('refuses a buyer on an admin endpoint', async () => {
      const buyer = signAccessToken({ id: PASSWORD_USER, email: EMAIL_PW, role: 'BUYER' });
      const res = await fetch(`${baseUrl}/api/admin/events`, {
        headers: { Authorization: `Bearer ${buyer}` },
      });
      expect(res.status).toBe(403);
    });

    it('refuses an unauthenticated caller on an admin endpoint', async () => {
      expect((await fetch(`${baseUrl}/api/admin/events`)).status).toBe(401);
    });

    it('allows an admin', async () => {
      const admin = signAccessToken({ id: PASSWORD_USER, email: EMAIL_PW, role: 'ADMIN' });
      const res = await fetch(`${baseUrl}/api/admin/events`, {
        headers: { Authorization: `Bearer ${admin}` },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('google flow configuration', () => {
    it('reports whether sign-in is available', async () => {
      const res = await fetch(`${baseUrl}/api/auth/providers`);
      expect(res.status).toBe(200);
      expect(typeof (await res.json()).google).toBe('boolean');
    });

    it('refuses to start a flow with no credentials configured', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/start`, { redirect: 'manual' });
      // 501 with no credentials; a redirect once they exist.
      expect([501, 302]).toContain(res.status);
    });

    it('refuses a callback whose state was never issued', async () => {
      const res = await fetch(
        `${baseUrl}/api/auth/google/callback?state=forged&code=whatever`,
        { redirect: 'manual' },
      );
      // Redirected back to the login page with an error, never signed in.
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('error=');
      expect(res.headers.get('set-cookie')).toBeNull();
    });
  });
});
