import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import {
  attemptPurchase, authHeaders, fetchSeatIds, loginBuyers, readMode, summarise, waitForAdmission,
} from './lib.js';

/**
 * Real buyers and bots in the same sale.
 *
 * A tenth of the traffic skips the queue entirely and hammers hold and
 * checkout as fast as it can — which is exactly what a bot does. The number
 * worth reading afterwards is not the error rate but the share of tickets the
 * bots walked away with.
 */
const BUYERS = Number(__ENV.BUYERS || 400);
const PEAK_VUS = Number(__ENV.PEAK_VUS || 200);
const BOT_SHARE = Number(__ENV.BOT_SHARE || 0.1);

const botPurchases = new Counter('fq_bot_purchases');
const humanPurchases = new Counter('fq_human_purchases');
const botAttempts = new Counter('fq_bot_attempts');

export const options = {
  scenarios: {
    mixed_traffic: {
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
  console.log(`mode=${mode} buyers=${tokens.length} bot share=${BOT_SHARE}`);
  return { mode, tokens, seats };
}

export default function (data) {
  const auth = authHeaders(data.tokens[__VU % data.tokens.length]);
  // A fixed slice of the virtual users are bots for the whole run, rather than
  // a coin flip per iteration — a bot is a client, not a behaviour.
  const isBot = __VU % Math.round(1 / BOT_SHARE) === 0;
  const seatId = data.seats[Math.floor(Math.random() * data.seats.length)];

  if (isBot) {
    botAttempts.add(1);
    // No queue, no waiting, no think time. Straight at the endpoints.
    const res = attemptPurchase(auth, seatId, data.mode);
    if (res.status === 201) botPurchases.add(1);
    check(res, { 'bot was answered': (r) => r.status > 0 });
    return;
  }

  if (data.mode === 'fairqueue' && !waitForAdmission(auth)) return;
  const res = attemptPurchase(auth, seatId, data.mode);
  if (res.status === 201) humanPurchases.add(1);
  sleep(0.5);
}

export function handleSummary(data) {
  const summary = summarise(data, 'bots');
  const n = (name) => (data.metrics[name] ? data.metrics[name].values.count ?? 0 : 0);

  const bots = n('fq_bot_purchases');
  const humans = n('fq_human_purchases');
  const total = bots + humans;

  summary.workload.botShare = BOT_SHARE;
  summary.bots = {
    attempts: n('fq_bot_attempts'),
    ticketsWonByBots: bots,
    ticketsWonByHumans: humans,
    // The headline: what proportion of the sale the bots took.
    botTicketShare: total > 0 ? Math.round((bots / total) * 10000) / 10000 : 0,
  };

  return {
    [`bench/results/bots-${summary.mode}.k6.json`]: JSON.stringify(summary, null, 2),
    stdout: `\n  bots won ${bots} of ${total} tickets (${((summary.bots.botTicketShare) * 100).toFixed(1)}%)\n`,
  };
}
