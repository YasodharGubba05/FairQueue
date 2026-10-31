import type { Request, Response } from 'express';
import { env } from '../env';

/**
 * The refresh token's cookie.
 *
 * HttpOnly so script cannot read it, which is the entire reason it lives here
 * rather than in localStorage: an XSS that can read a token can steal a
 * session, and one that merely sits next to a cookie cannot.
 *
 * SameSite=Lax means the browser will not attach it to a cross-site POST, so
 * the refresh endpoint is not CSRF-able on its own. The path is narrowed to
 * the auth routes, so the cookie is not sent with every seat-map request.
 */
export const REFRESH_COOKIE = 'fq_refresh';
const REFRESH_PATH = '/api/auth';

export function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // Secure is dropped on plain-http local development, where the browser
    // would otherwise refuse the cookie and nothing would work.
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: REFRESH_PATH,
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: REFRESH_PATH,
  });
}

/**
 * Read one cookie off the request.
 *
 * Written out rather than pulling in cookie-parser: this is the only cookie
 * the application has, and a dependency to split a header on ';' is not worth
 * the supply chain.
 */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
