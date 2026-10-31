import { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { signAccessToken, verifyAccessToken, type AccessClaims } from '../auth/tokens';

export type JwtPayload = AccessClaims;

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Kept so existing callers and tests do not have to change. */
export function signToken(payload: JwtPayload): string {
  return signAccessToken(payload);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed authorization header' });
    return;
  }

  const token = authHeader.slice(7).trim();
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    // The client cannot tell expiry from forgery here, and does not need to:
    // either way it should try /refresh and then give up.
    res.status(401).json({ error: 'Invalid or expired token', code: 'token_invalid' });
  }
}

/**
 * Role check as middleware rather than an `if` inside each handler.
 *
 * The two inline checks this replaces worked, but they were opt-in: a new
 * admin route could forget one and nothing would complain. A middleware is
 * visible in the route definition, where leaving it out is obvious.
 */
export function requireRole(...roles: Role[]) {
  return function check(req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ error: 'Not signed in' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      // 403, not 404: the caller is authenticated and simply not allowed.
      res.status(403).json({ error: 'You do not have access to this' });
      return;
    }
    next();
  };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      req.user = verifyAccessToken(authHeader.slice(7).trim());
    } catch {
      // An invalid optional token is simply no token.
    }
  }
  next();
}
