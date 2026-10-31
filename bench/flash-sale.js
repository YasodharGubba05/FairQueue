import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * The flash sale: a crowd arrives inside ten seconds and every one of them
 * wants a seat.
 *
 * The same script runs against both builds. In naive mode there is no queue to
 * join, so buyers go straight at checkout — which is the point: that is what
 * the "before" version makes everyone do.
 */
const BASE_URL = __ENV.API_URL || 'http://localhost:8080';
const EVENT_ID = __ENV.EVENT_ID || 'evt_headline';
const BUYERS = Number(__ENV.BUYERS || 800);
const PEAK_VUS = Number(__ENV.PEAK_VUS || 400);

const purchases = new Counter('fq_purchases');
const seatConflicts = new Counter('fq_seat_conflicts');
const rateLimited = new Counter('fq_rate_limited');
const admissionDenied = new Counter('fq_admission_denied');
const queueWait = new Trend('fq_queue_wait_ms', true);
const bought = new Rate('fq_bought');

export const options = {
  scenarios: {
    flash_sale: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        // Everybody shows up at once. That is the whole shape of the problem.
        { duration: '10s', target: PEAK_VUS },
        { duration: '50s', target: PEAK_VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Seats run out, so failed purchases are expected; the run itself must not
    // fall over, which is what the "before" build does.
    http_req_failed: ['rate<1.0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const mode = http.get(`${BASE_URL}/api/mode`).json('mode');

  const tokens = [];
  for (let i = 1; i <= BUYERS; i++) {
    const email = `buyer${String(i).padStart(4, '0')}@fairqueue.dev`;
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email, password: 'password123' }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'setup-login' } },
    );
    if (res.status === 200) tokens.push(res.json('token'));
  }

  const seats = http
    .get(`${BASE_URL}/api/events/${EVENT_ID}/seats`, { tags: { name: 'setup-seats' } })
    .json('seats')
    .map((s) => s.id);

  console.log(`mode=${mode} buyers=${tokens.length} seats=${seats.length}`);
  return { mode, tokens, seats };
}

export default function (data) {
  // One account per virtual user, so the per-account rate limit behaves the way
  // it would with real separate buyers.
  const token = data.tokens[__VU % data.tokens.length];
  const auth = {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  };

  if (data.mode === 'fairqueue') {
    if (!waitForAdmission(auth)) return;
  }

  // Pick anywhere in the venue, the way a real crowd spreads out.
  const seatId = data.seats[Math.floor(Math.random() * data.seats.length)];

  if (data.mode === 'fairqueue') {
    const hold = http.post(
      `${BASE_URL}/api/events/${EVENT_ID}/holds`,
      JSON.stringify({ seatIds: [seatId] }),
      { ...auth, tags: { name: 'hold' } },
    );
    if (!recordOutcome(hold)) return;
  }

  const checkout = http.post(
    `${BASE_URL}/api/events/${EVENT_ID}/checkout`,
    JSON.stringify({ seatIds: [seatId] }),
    { ...auth, tags: { name: 'checkout' } },
  );

  const won = checkout.status === 201;
  bought.add(won);
  if (won) purchases.add(1);
  recordOutcome(checkout);

  check(checkout, {
    'checkout answered sensibly': (r) => [201, 402, 403, 409, 429].includes(r.status),
  });

  sleep(0.5);
}

/** Classify a refusal, so the summary says why people did not get a seat. */
function recordOutcome(res) {
  if (res.status === 429) {
    rateLimited.add(1);
    return false;
  }
  if (res.status === 403) {
    admissionDenied.add(1);
    return false;
  }
  if (res.status === 409) {
    seatConflicts.add(1);
    return false;
  }
  return res.status === 201;
}

/**
 * Take a place in line and wait to be let in. Joining is idempotent, so a
 * retry after a dropped response never costs this buyer their place.
 */
function waitForAdmission(auth) {
  const startedAt = Date.now();

  const joined = http.post(`${BASE_URL}/api/events/${EVENT_ID}/queue/join`, null, {
    ...auth,
    tags: { name: 'queue-join' },
  });
  if (joined.status === 429) {
    rateLimited.add(1);
    return false;
  }
  if (joined.status !== 200) return false;
  if (joined.json('hasPass')) {
    queueWait.add(Date.now() - startedAt);
    return true;
  }

  // A real browser follows the once-a-second broadcast; k6 polls instead,
  // which costs a request but keeps the script to one protocol.
  for (let i = 0; i < 60; i++) {
    sleep(1);
    const state = http.get(`${BASE_URL}/api/events/${EVENT_ID}/queue`, {
      ...auth,
      tags: { name: 'queue-poll' },
    });
    if (state.status === 200 && state.json('hasPass')) {
      queueWait.add(Date.now() - startedAt);
      return true;
    }
  }
  return false;
}

export function handleSummary(data) {
  const mode = __ENV.MODE_LABEL || 'unknown';
  return {
    [`bench/results/flash-sale-${mode}.json`]: JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const value = (name, field = 'count') => (m[name] ? m[name].values[field] : 0);
  return `
  purchases            ${value('fq_purchases')}
  seat conflicts       ${value('fq_seat_conflicts')}
  rate limited         ${value('fq_rate_limited')}
  admission denied     ${value('fq_admission_denied')}
  http p95 (ms)        ${(m.http_req_duration?.values['p(95)'] ?? 0).toFixed(1)}
  http error rate      ${((m.http_req_failed?.values.rate ?? 0) * 100).toFixed(2)}%
  requests             ${value('http_reqs')}
`;
}
