import { check, sleep } from 'k6';
import {
  BASE_URL, EVENT_ID, attemptPurchase, authHeaders, fetchSeatIds,
  loginBuyers, readMode, summarise, waitForAdmission,
} from './lib.js';

/**
 * A crowd arrives inside ten seconds and every one of them wants a seat.
 * The shape of the problem this project exists to solve.
 */
const BUYERS = Number(__ENV.BUYERS || 600);
const PEAK_VUS = Number(__ENV.PEAK_VUS || 300);

export const options = {
  scenarios: {
    flash_sale: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: PEAK_VUS },
        { duration: '50s', target: PEAK_VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  // Seats run out, so failed purchases are expected and are not the subject.
  thresholds: {
    // k6 only surfaces a tagged sub-metric when a threshold references it, so
    // these exist to make the per-endpoint latency appear in the summary at
    // all. The bounds are deliberately loose: they are not pass/fail criteria,
    // the numbers themselves are the result.
    'http_req_duration{name:checkout}': ['p(95)<600000'],
    'http_req_duration{name:hold}': ['p(95)<600000'],
    http_req_failed: ['rate<1.0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const mode = readMode();
  const tokens = loginBuyers(BUYERS);
  const seats = fetchSeatIds();
  console.log(`mode=${mode} buyers=${tokens.length} seats=${seats.length}`);
  return { mode, tokens, seats };
}

export default function (data) {
  // One account per virtual user, so the per-account rate limit behaves as it
  // would with real separate buyers.
  const auth = authHeaders(data.tokens[__VU % data.tokens.length]);

  if (data.mode === 'fairqueue' && !waitForAdmission(auth)) return;

  const seatId = data.seats[Math.floor(Math.random() * data.seats.length)];
  const res = attemptPurchase(auth, seatId, data.mode);

  check(res, {
    'answered sensibly': (r) => [201, 402, 403, 409, 429].includes(r.status),
  });
  sleep(0.5);
}

export function handleSummary(data) {
  const summary = summarise(data, 'flash-sale');
  return {
    [`bench/results/flash-sale-${summary.mode}.k6.json`]: JSON.stringify(summary, null, 2),
    stdout: `\n  purchases ${summary.outcomes.purchases}  ·  p95 checkout ${summary.latencyMs.p95Checkout}ms  ·  errors ${(summary.httpErrorRate * 100).toFixed(1)}%\n`,
  };
}
