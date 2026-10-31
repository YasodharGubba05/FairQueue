import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';

/**
 * Two tokens, with very different jobs.
 *
 * The access token is a short-lived JWT the api verifies with no database
 * lookup. Being stateless is the point — it is what lets eight api pods
 * authenticate a request without agreeing about anything. The cost of
 * statelessness is that it cannot be revoked, so it lives for minutes.
 *
 * The refresh token is a long-lived opaque secret that only the database can
 * validate. It is the one that can be revoked, and it is rotated on every use.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;

export type AccessClaims = {
  id: string;
  email: string;
  role: Role;
};

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    // Pinned, so a token minted for something else cannot be replayed here.
    issuer: env.TOKEN_ISSUER,
    audience: env.TOKEN_AUDIENCE,
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: env.TOKEN_ISSUER,
    audience: env.TOKEN_AUDIENCE,
    algorithms: ['HS256'],
  }) as AccessClaims;
}

/**
 * The refresh token is stored hashed, never in the clear.
 *
 * A plain SHA-256 is right here where it would be wrong for a password: this
 * is 32 bytes of CSPRNG output, so there is no dictionary to attack and
 * nothing for a slow hash to buy. What it does buy is that a database leak
 * hands over no usable sessions.
 */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type IssuedRefresh = { token: string; expiresAt: Date; family: string };

export async function issueRefreshToken(userId: string, family?: string): Promise<IssuedRefresh> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const tokenFamily = family ?? randomUUID();

  await prisma.refreshToken.create({
    data: { userId, tokenHash: hash(token), family: tokenFamily, expiresAt },
  });

  return { token, expiresAt, family: tokenFamily };
}

export type RotationResult =
  | { ok: true; userId: string; refresh: IssuedRefresh }
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' };

/**
 * Exchange a refresh token for a new one.
 *
 * Rotation means a token is good exactly once. If a spent token is ever
 * presented again, there are only two explanations — a client raced itself, or
 * somebody stole it — and we cannot tell which from here. So the whole family
 * is revoked: the thief and the victim are both logged out, and the victim
 * notices. That is the right trade. A silent compromise is worse than an
 * unexpected sign-out.
 */
export async function rotateRefreshToken(token: string): Promise<RotationResult> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash(token) },
  });

  if (!existing) return { ok: false, reason: 'unknown' };

  if (existing.revokedAt) {
    // Reuse. Burn the family, including whatever token is currently live.
    await revokeFamily(existing.family, 'reuse detected');
    return { ok: false, reason: 'reused' };
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  // Spend the old one and mint its replacement in one transaction, so a crash
  // between the two cannot leave a session with no way forward and no way back.
  const refresh = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), revokedReason: 'rotated' },
    });

    const next = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: hash(next),
        family: existing.family,
        expiresAt,
      },
    });

    return { token: next, expiresAt, family: existing.family };
  });

  return { ok: true, userId: existing.userId, refresh };
}

/** Sign out this session only. */
export async function revokeToken(token: string, reason = 'logout'): Promise<void> {
  await prisma.refreshToken
    .updateMany({
      where: { tokenHash: hash(token), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    })
    .catch(() => {
      // Signing out must always appear to succeed: a caller holding an unknown
      // token is already in the state they asked for.
    });
}

/** Kill an entire login chain — used on reuse detection. */
export async function revokeFamily(family: string, reason: string): Promise<number> {
  const { count } = await prisma.refreshToken.updateMany({
    where: { family, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return count;
}

/** Sign out everywhere, for a password change or a lost device. */
export async function revokeAllForUser(userId: string, reason = 'logout all'): Promise<number> {
  const { count } = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return count;
}
