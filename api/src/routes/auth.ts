import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { verifyPassword } from '../password';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import {
  issueRefreshToken,
  revokeAllForUser,
  revokeToken,
  rotateRefreshToken,
  signAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from '../auth/tokens';
import { REFRESH_COOKIE, clearRefreshCookie, readCookie, setRefreshCookie } from '../auth/cookies';
import { consumeFlow, exchangeCode, isGoogleConfigured, startFlow } from '../auth/google';
import { findOrCreateFromGoogle } from '../auth/users';

export const authRouter = Router();

/**
 * Credential endpoints are the ones worth guessing at, so they are the ones
 * that get throttled hardest. Ten attempts per account per ten seconds is far
 * more than a person types and far less than a script wants.
 */
const loginLimit = rateLimit('login', { perUser: 10 });
const refreshLimit = rateLimit('refresh', { perUser: 30 });
const oauthLimit = rateLimit('oauth', { perUser: 20 });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** What the browser gets: the access token in the body, refresh in a cookie. */
async function issueSession(res: Response, user: { id: string; email: string; role: 'BUYER' | 'ADMIN' }) {
  const refresh = await issueRefreshToken(user.id);
  setRefreshCookie(res, refresh.token, refresh.expiresAt);

  return {
    accessToken: signAccessToken(user),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user,
  };
}

authRouter.post('/api/auth/login', loginLimit, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid email or password format' });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  // An account created through a provider has no password. It must never be
  // possible to sign into one with an empty or guessed credential, so a null
  // hash fails here rather than being passed to the verifier.
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    // One message for "no such user" and "wrong password", so the response
    // does not tell an attacker which addresses are registered.
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  res.json(await issueSession(res, { id: user.id, email: user.email, role: user.role }));
});

/**
 * Trade the refresh cookie for a new access token, and a new refresh token.
 *
 * Rotation means the old one is dead the moment this succeeds. If a spent
 * token turns up, the whole login chain is revoked — see tokens.ts.
 */
authRouter.post('/api/auth/refresh', refreshLimit, async (req: Request, res: Response) => {
  const token = readCookie(req, REFRESH_COOKIE);
  if (!token) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }

  const result = await rotateRefreshToken(token);
  if (!result.ok) {
    clearRefreshCookie(res);
    res.status(401).json({
      error: result.reason === 'reused' ? 'Session ended for security reasons' : 'Session expired',
      reason: result.reason,
    });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: result.userId },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    clearRefreshCookie(res);
    res.status(401).json({ error: 'Session expired' });
    return;
  }

  setRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
  // Role is re-read from the database on every refresh, so a demotion takes
  // effect within one access-token lifetime rather than lasting a month.
  res.json({
    accessToken: signAccessToken(user),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user,
  });
});

authRouter.post('/api/auth/logout', async (req: Request, res: Response) => {
  const token = readCookie(req, REFRESH_COOKIE);
  if (token) await revokeToken(token, 'logout');
  clearRefreshCookie(res);
  // Always 204: signing out must not report whether the session was real.
  res.status(204).end();
});

authRouter.post('/api/auth/logout-all', requireAuth, async (req: Request, res: Response) => {
  const revoked = await revokeAllForUser(req.user!.id, 'logout all');
  clearRefreshCookie(res);
  res.json({ revoked });
});

authRouter.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

/** Lets the frontend decide whether to draw the Google button at all. */
authRouter.get('/api/auth/providers', (_req: Request, res: Response) => {
  res.json({ google: isGoogleConfigured() });
});

/**
 * Begin Google sign-in. The browser is redirected; the verifier, nonce and
 * state stay on the server.
 */
authRouter.get('/api/auth/google/start', oauthLimit, async (req: Request, res: Response) => {
  if (!isGoogleConfigured()) {
    res.status(501).json({ error: 'Google sign-in is not configured on this server' });
    return;
  }

  // Only a path is accepted, never a full URL: taking an absolute returnTo
  // from the query string is how open redirects happen.
  const requested = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/';
  const returnTo = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  res.redirect(await startFlow(returnTo));
});

/** Where Google sends the browser back. */
authRouter.get('/api/auth/google/callback', oauthLimit, async (req: Request, res: Response) => {
  const fail = (reason: string) =>
    res.redirect(`${env.WEB_ORIGIN}/login?error=${encodeURIComponent(reason)}`);

  if (!isGoogleConfigured()) return fail('not_configured');

  // The user declined, or Google refused.
  if (typeof req.query.error === 'string') return fail(req.query.error);

  const state = typeof req.query.state === 'string' ? req.query.state : null;
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  if (!state || !code) return fail('missing_parameters');

  // Single-use: a replayed callback finds nothing here and is refused.
  const flow = await consumeFlow(state);
  if (!flow) return fail('invalid_state');

  try {
    const identity = await exchangeCode(code, flow);
    const user = await findOrCreateFromGoogle(identity);

    const refresh = await issueRefreshToken(user.id);
    setRefreshCookie(res, refresh.token, refresh.expiresAt);

    // The access token is not put in the URL — a query string lands in
    // browser history and server logs. The browser lands on a page that
    // immediately calls /refresh with the cookie it now holds.
    res.redirect(`${env.WEB_ORIGIN}/auth/callback?returnTo=${encodeURIComponent(flow.returnTo)}`);
  } catch (err) {
    console.warn('[auth] google sign-in failed:', (err as Error).message);
    return fail('sign_in_failed');
  }
});
