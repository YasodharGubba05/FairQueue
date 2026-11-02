import { check } from 'k6';
import {
  attemptPurchase, authHeaders, fetchSeatIds, loginBuyers, readMode, summarise, waitForAdmission,
} from './lib.js';

/**
 * Everybody wants the same fifty seats.
 *
 * This is the contention test rather than the throughput one: far more buyers
 * than seats, all aimed at the same small block, so almost every request is a
 * collision. It is the workload that makes a naive read-then-write checkout
 * sell the same seat repeatedly.
 */
const BUYERS = Number(__ENV.BUYERS || 300);
const PEAK_VUS = Number(__ENV.PEAK_VUS || 200);
const HOT_SEAT_COUNT = Number(__ENV.HOT_SEATS || 50);

export const options = {
  scenarios: {
    hot_seats: {
      executor: 'shared-iterations',
      vus: PEAK_VUS,
      iterations: Number(__ENV.ITERATIONS || 1500),
      maxDuration: '3m',
    },
  },
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
  // The first N seats of the venue. The seat list comes back in a stable
  // order, so both modes fight over exactly the same block.
  const seats = fetchSeatIds().slice(0, HOT_SEAT_COUNT);
  console.log(`mode=${mode} buyers=${tokens.length} hot seats=${HOT_SEAT_COUNT}`);
  return { mode, tokens, seats };
}

export default function (data) {
  const auth = authHeaders(data.tokens[__VU % data.tokens.length]);

  if (data.mode === 'fairqueue' && !waitForAdmission(auth)) return;

  const seatId = data.seats[Math.floor(Math.random() * data.seats.length)];
  const res = attemptPurchase(auth, seatId, data.mode);

  check(res, {
    'answered sensibly': (r) => [201, 402, 403, 409, 429].includes(r.status),
  });
}

export function handleSummary(data) {
  const summary = summarise(data, 'hot-seats');
  summary.workload.hotSeats = HOT_SEAT_COUNT;
  return {
    [`bench/results/hot-seats-${summary.mode}.k6.json`]: JSON.stringify(summary, null, 2),
    stdout: `\n  purchases ${summary.outcomes.purchases}  ·  conflicts ${summary.outcomes.seatConflicts}  ·  p95 checkout ${summary.latencyMs.p95Checkout}ms\n`,
  };
}
