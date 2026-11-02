import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import {
  BASE_URL, EVENT_ID, attemptPurchase, authHeaders, fetchSeatIds, loginBuyers, readMode,
  summarise,
} from './lib.js';

/**
 * How much can it take before it starts failing?
 *
 * Arrival rate is stepped up in stages and the error rate is measured per
 * stage, so the answer is a number with a meaning: the highest arrival rate at
 * which the service still answered cleanly. A single fixed-load run cannot
 * produce that — it only tells you whether one particular load worked.
 *
 * Deliberately a constant-arrival-rate executor, not ramping VUs. Arrival rate
 * is the thing a flash sale actually does to you: people arrive at a rate they
 * choose, and they do not wait politely for a previous request to finish
 * before sending the next. Closed-loop VU models hide saturation, because a
 * slowing server simply receives fewer requests.
 *
 * Buyers are admitted up front rather than queueing during the ramp. Admission
 * is paced by the worker at admitPerSec, so queueing inside the measured
 * window would measure that pacing rather than the service — and the first
 * attempt at this did exactly that: every request was refused for want of a
 * pass, so fairqueue appeared to break at 50 req/s having sold nothing at all.
 * Passes are granted first; the ramp then measures the booking path itself.
 */
const BUYERS = Number(__ENV.BUYERS || 400);
const START_RATE = Number(__ENV.START_RATE || 50);
const STEP = Number(__ENV.STEP || 100);
const STEPS = Number(__ENV.STEPS || 8);
const STAGE_SECONDS = Number(__ENV.STAGE_SECONDS || 20);

/** Arrival rate tagged onto each stage, so the summary can be read per stage. */
const stageRate = new Trend('fq_stage_rate');

const stages = [];
for (let i = 0; i < STEPS; i++) {
  stages.push({ target: START_RATE + i * STEP, duration: `${STAGE_SECONDS}s` });
}

export const options = {
  // Admitting several hundred buyers takes longer than the default minute.
  setupTimeout: '180s',
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: START_RATE,
      timeUnit: '1s',
      // Generously provisioned: if k6 runs out of VUs it throttles itself and
      // the measurement becomes about the load generator, not the service.
      preAllocatedVUs: 200,
      maxVUs: 2000,
      stages,
    },
  },
  thresholds: {
    // k6 only surfaces a tagged sub-metric when a threshold references it, so
    // these exist to make the per-endpoint latency appear in the summary at
    // all. The bounds are deliberately loose: they are not pass/fail criteria,
    // the numbers themselves are the result.
    'http_req_duration{name:checkout}': ['p(95)<600000'],
    'http_req_duration{name:hold}': ['p(95)<600000'],
    // Abort as soon as a stage is clearly failing, so the run does not spend
    // minutes hammering a service that has already broken.
    http_req_failed: [{ threshold: 'rate<0.5', abortOnFail: true, delayAbortEval: '10s' }],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const mode = readMode();
  const tokens = loginBuyers(BUYERS);
  const seats = fetchSeatIds();

  // Admit everyone before the clock starts, so the ramp measures the booking
  // path rather than the worker's admission rate.
  //
  // Everyone joins first and the wait happens once, rather than each buyer
  // being walked through its own poll loop — that took a second per buyer and
  // blew the setup timeout long before anyone was admitted.
  let admitted = tokens.length;
  if (mode === 'fairqueue') {
    for (const token of tokens) {
      http.post(`${BASE_URL}/api/events/${EVENT_ID}/queue/join`, null, {
        ...authHeaders(token),
        tags: { name: 'setup-join' },
      });
    }

    admitted = 0;
    for (let attempt = 0; attempt < 60 && admitted < tokens.length; attempt++) {
      sleep(1);
      admitted = 0;
      for (const token of tokens) {
        const state = http.get(`${BASE_URL}/api/events/${EVENT_ID}/queue`, {
          ...authHeaders(token),
          tags: { name: 'setup-poll' },
        });
        if (state.status === 200 && state.json('hasPass')) admitted += 1;
      }
    }
  }

  console.log(
    `mode=${mode} admitted=${admitted}/${tokens.length} stepping ${START_RATE}→${START_RATE + (STEPS - 1) * STEP} req/s over ${STEPS} stages`,
  );
  return { mode, tokens, seats, admitted };
}

export default function (data) {
  const auth = authHeaders(data.tokens[__VU % data.tokens.length]);
  const seatId = data.seats[Math.floor(Math.random() * data.seats.length)];

  const res = attemptPurchase(auth, seatId, data.mode);
  stageRate.add(res.timings ? res.timings.duration : 0);

  check(res, { 'did not 5xx': (r) => r.status < 500 && r.status !== 0 });
}

export function handleSummary(data) {
  const summary = summarise(data, 'breaking-point');
  summary.workload = {
    ...summary.workload,
    startRate: START_RATE,
    step: STEP,
    steps: STEPS,
    stageSeconds: STAGE_SECONDS,
    peakRateAttempted: START_RATE + (STEPS - 1) * STEP,
  };

  // The run was aborted by the threshold if it ended early, which is itself
  // the finding: the service broke before the last stage.
  const ranSeconds = Math.round((data.state?.testRunDurationMs ?? 0) / 1000);
  const plannedSeconds = STEPS * STAGE_SECONDS;
  const completedStages = Math.min(STEPS, Math.floor(ranSeconds / STAGE_SECONDS));

  summary.ceiling = {
    admittedBuyers: data.setup_data?.admitted ?? null,
    ranSeconds,
    plannedSeconds,
    abortedEarly: ranSeconds < plannedSeconds - STAGE_SECONDS,
    completedStages,
    // The highest arrival rate that ran a full stage before anything aborted.
    // Conservative by construction: the true ceiling is somewhere between this
    // and the next step.
    sustainedRatePerSec: Math.max(START_RATE, START_RATE + (completedStages - 1) * STEP),
  };

  return {
    [`bench/results/breaking-point-${summary.mode}.k6.json`]: JSON.stringify(summary, null, 2),
    stdout: `\n  sustained ${summary.ceiling.sustainedRatePerSec} req/s  ·  p95 checkout ${summary.latencyMs.p95Checkout}ms  ·  errors ${(summary.httpErrorRate * 100).toFixed(1)}%${summary.ceiling.abortedEarly ? '  ·  ABORTED EARLY' : ''}\n`,
  };
}
