import http from 'k6/http';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';

/**
 * Shared by every k6 script, so the two modes are driven identically.
 *
 * The one thing that differs between naive and fairqueue is the queue: naive
 * has none, so its buyers go straight at checkout. That difference IS the
 * experiment, and everything else — the accounts, the seats, the think time,
 * the way a refusal is classified — is held constant.
 */
export const BASE_URL = __ENV.API_URL || 'http://localhost:4000';
export const EVENT_ID = __ENV.EVENT_ID || 'evt_headline';

export const purchases = new Counter('fq_purchases');
export const seatConflicts = new Counter('fq_seat_conflicts');
export const rateLimited = new Counter('fq_rate_limited');
export const admissionDenied = new Counter('fq_admission_denied');
export const serverErrors = new Counter('fq_server_errors');

/** Log in `count` seeded buyers and return their tokens. */
export function loginBuyers(count) {
  const tokens = [];
  for (let i = 1; i <= count; i++) {
    const email = `buyer${String(i).padStart(4, '0')}@fairqueue.dev`;
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email, password: 'password123' }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'setup-login' } },
    );
    // The field was renamed when refresh tokens arrived; accept either so a
    // stale api does not silently produce a run with no authenticated users.
    const token = res.json('accessToken') || res.json('token');
    if (res.status === 200 && token) tokens.push(token);
  }
  return tokens;
}

export function fetchSeatIds() {
  return http
    .get(`${BASE_URL}/api/events/${EVENT_ID}/seats`, { tags: { name: 'setup-seats' } })
    .json('seats')
    .map((s) => s.id);
}

export function readMode() {
  return http.get(`${BASE_URL}/api/mode`).json('mode');
}

export function authHeaders(token) {
  return {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  };
}

/**
 * Classify a response so the summary can say *why* people did not get a seat.
 * A run where everyone was rate limited and one where the seats sold out look
 * identical in an error rate and could not be more different.
 */
export function classify(res) {
  if (res.status === 429) { rateLimited.add(1); return 'rate_limited'; }
  if (res.status === 403) { admissionDenied.add(1); return 'no_pass'; }
  if (res.status === 409) { seatConflicts.add(1); return 'seat_gone'; }
  if (res.status >= 500 || res.status === 0) { serverErrors.add(1); return 'server_error'; }
  if (res.status === 201) { purchases.add(1); return 'bought'; }
  return 'other';
}

/**
 * Take a place in line and wait to be let in.
 *
 * Joining is idempotent, so a retry after a dropped response never costs this
 * buyer their place — which is the property being demonstrated.
 */
export function waitForAdmission(auth, maxSeconds = 60) {
  const joined = http.post(`${BASE_URL}/api/events/${EVENT_ID}/queue/join`, null, {
    ...auth,
    tags: { name: 'queue-join' },
  });
  if (joined.status === 429) { rateLimited.add(1); return false; }
  if (joined.status !== 200) return false;
  if (joined.json('hasPass')) return true;

  for (let i = 0; i < maxSeconds; i++) {
    sleep(1);
    const state = http.get(`${BASE_URL}/api/events/${EVENT_ID}/queue`, {
      ...auth,
      tags: { name: 'queue-poll' },
    });
    if (state.status === 200 && state.json('hasPass')) return true;
  }
  return false;
}

/** Hold then buy. In naive mode there is nothing to hold, so it just buys. */
export function attemptPurchase(auth, seatId, mode) {
  if (mode === 'fairqueue') {
    const hold = http.post(
      `${BASE_URL}/api/events/${EVENT_ID}/holds`,
      JSON.stringify({ seatIds: [seatId] }),
      { ...auth, tags: { name: 'hold' } },
    );
    if (classify(hold) !== 'other' && hold.status !== 201) return hold;
  }

  const checkout = http.post(
    `${BASE_URL}/api/events/${EVENT_ID}/checkout`,
    JSON.stringify({ seatIds: [seatId] }),
    { ...auth, tags: { name: 'checkout' } },
  );
  classify(checkout);
  return checkout;
}

/**
 * The summary both modes write, in one shape so compare.ts can read either.
 *
 * p95 is taken from the checkout endpoint alone rather than across every
 * request. Comparing whole-run p95 would be dishonest: fairqueue buyers also
 * join and poll a queue, so their request mix is different by design. Checkout
 * is the same endpoint doing the same database work in both modes, which makes
 * it the only latency comparison worth quoting.
 */
export function summarise(data, testName) {
  const m = data.metrics;
  const n = (name, field = 'count') => (m[name] ? m[name].values[field] ?? 0 : 0);
  const checkout = m['http_req_duration{name:checkout}'];

  return {
    test: testName,
    mode: __ENV.MODE_LABEL || 'unknown',
    workload: {
      peakVus: Number(__ENV.PEAK_VUS || 0),
      buyers: Number(__ENV.BUYERS || 0),
      durationSeconds: Math.round((data.state?.testRunDurationMs ?? 0) / 1000),
    },
    requests: n('http_reqs'),
    requestsPerSec: Math.round((n('http_reqs', 'rate') ?? 0) * 10) / 10,
    httpErrorRate: Math.round((n('http_req_failed', 'rate') ?? 0) * 10000) / 10000,
    latencyMs: {
      // Whole-run figures, kept for context but never used for the comparison.
      p95All: round(n('http_req_duration', 'p(95)')),
      p99All: round(n('http_req_duration', 'p(99)')),
      // The comparable one.
      p95Checkout: checkout ? round(checkout.values['p(95)']) : null,
      p99Checkout: checkout ? round(checkout.values['p(99)']) : null,
      maxCheckout: checkout ? round(checkout.values.max) : null,
    },
    outcomes: {
      purchases: n('fq_purchases'),
      seatConflicts: n('fq_seat_conflicts'),
      rateLimited: n('fq_rate_limited'),
      admissionDenied: n('fq_admission_denied'),
      serverErrors: n('fq_server_errors'),
    },
  };
}

function round(value) {
  return value === undefined ? null : Math.round(value * 10) / 10;
}
