import type { Role } from '@prisma/client';
import { prisma } from '../db';
import type { GoogleIdentity } from './google';

/**
 * Finding or creating the account behind a provider identity.
 *
 * The order of the lookups is the security decision here, and it runs from
 * most trustworthy to least:
 *
 *   1. provider + subject — the account we already linked. Immutable.
 *   2. a verified email   — the same person arriving by a new route, linked.
 *   3. a new account      — nobody we have seen before.
 *
 * Matching on email at all is only safe because the caller has already
 * refused any identity Google did not mark as verified. Without that check,
 * signing up to a provider with somebody else's address would take over their
 * FairQueue account.
 */
export type ResolvedUser = {
  id: string;
  email: string;
  role: Role;
  created: boolean;
  linked: boolean;
};

const PROVIDER_GOOGLE = 'google';

export async function findOrCreateFromGoogle(identity: GoogleIdentity): Promise<ResolvedUser> {
  if (!identity.emailVerified) {
    // Belt and braces: google.ts refuses these already, and this must never
    // be the only place that does.
    throw new Error('refusing to link an unverified email address');
  }

  // 1. Already linked.
  const existingIdentity = await prisma.oAuthIdentity.findUnique({
    where: { provider_subject: { provider: PROVIDER_GOOGLE, subject: identity.subject } },
    include: { user: { select: { id: true, email: true, role: true } } },
  });

  if (existingIdentity) {
    await prisma.oAuthIdentity.update({
      where: { id: existingIdentity.id },
      data: { lastLogin: new Date(), email: identity.email },
    });
    return { ...existingIdentity.user, created: false, linked: false };
  }

  // 2. Same person, new route. Link the identity to the account they have.
  const byEmail = await prisma.user.findUnique({
    where: { email: identity.email },
    select: { id: true, email: true, role: true },
  });

  if (byEmail) {
    await prisma.oAuthIdentity.create({
      data: {
        userId: byEmail.id,
        provider: PROVIDER_GOOGLE,
        subject: identity.subject,
        email: identity.email,
      },
    });
    // Signing in through a provider that verified the address proves it.
    await prisma.user.update({
      where: { id: byEmail.id },
      data: { emailVerified: true },
    });
    return { ...byEmail, created: false, linked: true };
  }

  // 3. Brand new. Note what is NOT set: no role is taken from the provider.
  // A new account is a BUYER, full stop — privilege is never something an
  // identity provider can hand out.
  const created = await prisma.user.create({
    data: {
      email: identity.email,
      emailVerified: true,
      passwordHash: null,
      identities: {
        create: {
          provider: PROVIDER_GOOGLE,
          subject: identity.subject,
          email: identity.email,
        },
      },
    },
    select: { id: true, email: true, role: true },
  });

  return { ...created, created: true, linked: true };
}
