import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import jwt, { type JwtHeader } from 'jsonwebtoken';
import { redis } from '../redis';
import { env } from '../env';

/**
 * Google sign-in, as OpenID Connect Authorization Code with PKCE.
 *
 * Three separate random values do three separate jobs here, and conflating
 * them is the usual way this gets built wrong:
 *
 *   state     ties the callback to the browser that started it — CSRF
 *   nonce     ties the ID token to this request — token replay
 *   verifier  ties the code exchange to this client — code interception
 *
 * The client secret and the verifier never leave the server. The browser only
 * ever sees the authorize URL and, at the end, a redirect.
 */
const GOOGLE_ISSUERS: [string, string] = [
  'https://accounts.google.com',
  'accounts.google.com',
];
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** A login attempt in flight. Short-lived: a sign-in takes seconds, not hours. */
const FLOW_TTL_SECONDS = 10 * 60;
const flowKey = (state: string) => `oauth:google:${state}`;

export type PendingFlow = { verifier: string; nonce: string; returnTo: string };

export function isGoogleConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

/**
 * Begin a login: mint the three values, remember two of them server-side, and
 * hand back the URL to send the browser to.
 */
export async function startFlow(returnTo: string): Promise<string> {
  const state = base64url(randomBytes(32));
  const nonce = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(32));
  // S256, never "plain": a plain challenge is the verifier, so anyone who sees
  // the authorize request can complete the exchange.
  const challenge = base64url(createHash('sha256').update(verifier).digest());

  const pending: PendingFlow = { verifier, nonce, returnTo };
  await redis.set(flowKey(state), JSON.stringify(pending), 'EX', FLOW_TTL_SECONDS);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Always ask, so switching account is possible and a stale Google session
    // cannot silently sign someone in as the wrong person.
    prompt: 'select_account',
  });

  return `${AUTHORIZE_URL}?${params}`;
}

/**
 * Claim a login attempt.
 *
 * Deleting as we read makes state single-use: a replayed callback finds
 * nothing and is refused, which is what stops the same authorization code
 * being walked through twice.
 */
export async function consumeFlow(state: string): Promise<PendingFlow | null> {
  const raw = await redis.getdel(flowKey(state));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingFlow;
  } catch {
    return null;
  }
}

/** Google's signing keys, cached — they rotate slowly and fetching is costly. */
/** Only the fields Node needs to build a public key from a JWK. */
type SigningJwk = {
  kty: string;
  n?: string;
  e?: string;
  kid?: string;
  alg?: string;
  use?: string;
};
type Jwks = { keys: SigningJwk[] };
let jwksCache: { keys: Jwks['keys']; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getSigningKey(kid: string | undefined): Promise<string> {
  const fresh = jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (!fresh) {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`could not fetch Google signing keys (${res.status})`);
    const body = (await res.json()) as Jwks;
    jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() };
  }

  let key = jwksCache!.keys.find((k) => k.kid === kid);

  // An unknown kid usually means Google rotated since we cached. Refetch once
  // before giving up, rather than failing every login for an hour.
  if (!key) {
    const res = await fetch(JWKS_URL);
    if (res.ok) {
      const body = (await res.json()) as Jwks;
      jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() };
      key = jwksCache.keys.find((k) => k.kid === kid);
    }
  }
  if (!key) throw new Error('ID token signed with an unknown key');

  // Node turns a JWK into a key object directly, so verifying Google's
  // signature needs no JWKS library.
  return createPublicKey({ key: key as never, format: 'jwk' })
    .export({ type: 'spki', format: 'pem' })
    .toString();
}

export type GoogleIdentity = {
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string;
};

type IdTokenClaims = {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

/** Swap the code for tokens, then check the ID token properly. */
export async function exchangeCode(code: string, flow: PendingFlow): Promise<GoogleIdentity> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: flow.verifier,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google rejected the code exchange (${res.status})`);
  }

  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error('Google returned no ID token');

  return verifyIdToken(body.id_token, flow.nonce);
}

/**
 * Verify an ID token the way the spec requires, not just by decoding it.
 *
 * Signature, issuer, audience and expiry are all checked — and the nonce
 * against the one minted for this attempt, which is what makes a token
 * captured from some other login useless here.
 */
export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleIdentity> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === 'string') throw new Error('ID token is not a JWT');

  const header = decoded.header as JwtHeader;
  if (header.alg !== 'RS256') {
    // Refusing anything else is what closes the alg=none and HMAC-confusion
    // families of attack.
    throw new Error(`unexpected ID token algorithm: ${header.alg}`);
  }

  const publicKey = await getSigningKey(header.kid);

  const claims = jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    audience: env.GOOGLE_CLIENT_ID,
    issuer: GOOGLE_ISSUERS,
  }) as IdTokenClaims;

  if (!claims.nonce || claims.nonce !== expectedNonce) {
    throw new Error('ID token nonce does not match this sign-in attempt');
  }
  if (!claims.email) {
    throw new Error('Google returned no email address');
  }
  // An unverified address cannot be used to claim an account: otherwise
  // anyone could sign up to a provider with someone else's email and take
  // over their FairQueue account.
  if (claims.email_verified !== true) {
    throw new Error('Google has not verified that email address');
  }

  return {
    subject: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: true,
    name: claims.name,
  };
}
