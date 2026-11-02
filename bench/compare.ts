import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Turns the result files into RESULTS.md.
 *
 * Every number in that document is read from bench/results/*.json. Nothing is
 * typed by hand and nothing is inferred — if a run did not happen, its row
 * says so rather than being filled in with something plausible. That rule is
 * the only reason the table is worth anything.
 */
const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'bench', 'results');

type Mode = 'naive' | 'fairqueue';

type Result = {
  scenario: string;
  mode: Mode;
  startedAt: string;
  machine: Record<string, string | number>;
  workload: Record<string, string>;
  k6: {
    requests: number;
    requestsPerSec: number;
    httpErrorRate: number;
    latencyMs: { p95Checkout: number | null; p99Checkout: number | null; p95All: number | null };
    outcomes: {
      purchases: number;
      seatConflicts: number;
      rateLimited: number;
      admissionDenied: number;
      serverErrors: number;
    };
    bots?: { ticketsWonByBots: number; ticketsWonByHumans: number; botTicketShare: number };
    ceiling?: { sustainedRatePerSec: number; abortedEarly: boolean; completedStages: number };
  } | null;
  database: {
    orders: number;
    tickets: number;
    distinctSeatsSold: number;
    oversoldSeats: number;
    duplicateTickets: number;
    uniqueIndexPresent: boolean;
  };
};

function load(): Result[] {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.k6.json') && f !== 'scale-test.json')
    .map((f) => JSON.parse(readFileSync(path.join(RESULTS_DIR, f), 'utf8')) as Result)
    .filter((r) => r && r.scenario && r.mode);
}

const n = (value: number | null | undefined, suffix = '') =>
  value === null || value === undefined ? '—' : `${value}${suffix}`;

const pct = (rate: number | null | undefined) =>
  rate === null || rate === undefined ? '—' : `${(rate * 100).toFixed(2)}%`;

/** Percentage change, phrased so the direction is unambiguous. */
function improvement(before: number | null, after: number | null): string {
  if (before === null || after === null || before === 0) return '—';
  const delta = ((before - after) / before) * 100;
  if (Math.abs(delta) < 1) return 'no change';
  return delta > 0 ? `${delta.toFixed(0)}% faster` : `${Math.abs(delta).toFixed(0)}% slower`;
}

function pair(results: Result[], scenario: string) {
  return {
    naive: results.find((r) => r.scenario === scenario && r.mode === 'naive') ?? null,
    fairqueue: results.find((r) => r.scenario === scenario && r.mode === 'fairqueue') ?? null,
  };
}

function machineBlock(results: Result[]): string {
  const spec = results[0]?.machine;
  if (!spec) return '_No runs recorded._';
  return [
    `| | |`,
    `|---|---|`,
    `| CPU | ${spec.cpuModel} (${spec.cpuCores} cores) |`,
    `| Memory | ${spec.memoryGb} GB |`,
    `| OS | ${spec.platform} ${spec.osRelease} (${spec.arch}) |`,
    `| Node | ${spec.nodeVersion} |`,
    `| PostgreSQL | ${spec.postgresVersion} |`,
    `| Redis | ${spec.redisVersion} |`,
    `| k6 | ${spec.k6Version} |`,
  ].join('\n');
}

function correctnessTable(results: Result[]): string {
  const rows = ['| Scenario | Build | Tickets | Distinct seats | Oversold seats | Duplicate tickets |', '|---|---|---|---|---|---|'];
  for (const scenario of ['hot-seats', 'flash-sale', 'bots', 'breaking-point']) {
    const { naive, fairqueue } = pair(results, scenario);
    for (const [label, r] of [['naive', naive], ['fairqueue', fairqueue]] as const) {
      if (!r) continue;
      const d = r.database;
      rows.push(
        `| ${scenario} | ${label} | ${d.tickets} | ${d.distinctSeatsSold} | **${d.oversoldSeats}** | ${d.duplicateTickets} |`,
      );
    }
  }
  return rows.length > 2 ? rows.join('\n') : '_No runs recorded._';
}

function latencyTable(results: Result[]): string {
  const rows = [
    '| Scenario | p95 checkout (naive) | p95 checkout (fairqueue) | Change |',
    '|---|---|---|---|',
  ];
  let any = false;
  for (const scenario of ['hot-seats', 'flash-sale', 'bots', 'breaking-point']) {
    const { naive, fairqueue } = pair(results, scenario);
    if (!naive?.k6 && !fairqueue?.k6) continue;
    any = true;
    const a = naive?.k6?.latencyMs.p95Checkout ?? null;
    const b = fairqueue?.k6?.latencyMs.p95Checkout ?? null;
    rows.push(`| ${scenario} | ${n(a, ' ms')} | ${n(b, ' ms')} | ${improvement(a, b)} |`);
  }
  return any ? rows.join('\n') : '_No runs recorded._';
}

function throughputTable(results: Result[]): string {
  const rows = [
    '| Scenario | Build | Requests | Req/s | Purchases | HTTP errors |',
    '|---|---|---|---|---|---|',
  ];
  let any = false;
  for (const scenario of ['hot-seats', 'flash-sale', 'bots', 'breaking-point']) {
    const { naive, fairqueue } = pair(results, scenario);
    for (const [label, r] of [['naive', naive], ['fairqueue', fairqueue]] as const) {
      if (!r?.k6) continue;
      any = true;
      rows.push(
        `| ${scenario} | ${label} | ${r.k6.requests} | ${r.k6.requestsPerSec} | ${r.k6.outcomes.purchases} | ${pct(r.k6.httpErrorRate)} |`,
      );
    }
  }
  return any ? rows.join('\n') : '_No runs recorded._';
}

function botTable(results: Result[]): string {
  const { naive, fairqueue } = pair(results, 'bots');
  if (!naive?.k6?.bots && !fairqueue?.k6?.bots) return '_No bot runs recorded._';
  const rows = ['| Build | Bot tickets | Human tickets | Share won by bots |', '|---|---|---|---|'];
  for (const [label, r] of [['naive', naive], ['fairqueue', fairqueue]] as const) {
    const b = r?.k6?.bots;
    if (!b) continue;
    rows.push(
      `| ${label} | ${b.ticketsWonByBots} | ${b.ticketsWonByHumans} | **${(b.botTicketShare * 100).toFixed(1)}%** |`,
    );
  }
  return rows.join('\n');
}

function ceilingTable(results: Result[]): string {
  const { naive, fairqueue } = pair(results, 'breaking-point');
  if (!naive?.k6?.ceiling && !fairqueue?.k6?.ceiling) return '_No breaking-point runs recorded._';
  const rows = [
    '| Build | Sustained arrival rate | Stages completed | Aborted early | p95 checkout |',
    '|---|---|---|---|---|',
  ];
  for (const [label, r] of [['naive', naive], ['fairqueue', fairqueue]] as const) {
    const c = r?.k6?.ceiling;
    if (!c) continue;
    rows.push(
      `| ${label} | **${c.sustainedRatePerSec} req/s** | ${c.completedStages} | ${c.abortedEarly ? 'yes' : 'no'} | ${n(r?.k6?.latencyMs.p95Checkout ?? null, ' ms')} |`,
    );
  }
  return rows.join('\n');
}

function scaleSection(): string {
  const file = path.join(RESULTS_DIR, 'scale-test.json');
  if (!existsSync(file)) {
    return [
      '**Not measured.** The Kubernetes manifests and `bench/scale-test.sh` are written and',
      'reviewed, but have never been run against a live cluster — the development machine has',
      'no container runtime installed. No autoscaling figure is claimed here, and none will',
      'appear until `bench/results/scale-test.json` exists. See `k8s/README.md`.',
    ].join('\n');
  }
  const r = JSON.parse(readFileSync(file, 'utf8'));
  return [
    '| | |',
    '|---|---|',
    `| Replicas at rest | ${r.replicas_at_rest} |`,
    `| Replicas at peak | **${r.replicas_peak}** |`,
    `| Replicas after cooldown | ${r.replicas_after_cooldown} |`,
    `| Peak CPU vs request | ${r.cpu_percent_peak}% |`,
    `| Scaled up | ${r.scaled_up ? 'yes' : 'no'} |`,
    `| Scaled back down | ${r.scaled_back_down ? 'yes' : 'no'} |`,
  ].join('\n');
}

function main() {
  const results = load();
  const runAt = results.length > 0
    ? results.map((r) => r.startedAt).sort().slice(-1)[0]
    : null;

  const doc = `# Benchmark results

Every number in this file is read from \`bench/results/*.json\` by
\`bench/compare.ts\`. Nothing here is typed by hand. A measurement that was not
taken says so rather than being filled in with something plausible.

Reproduce with \`make bench\`, or one scenario with
\`make bench-one SCENARIO=hot-seats MODE=naive\`.

${runAt ? `Last run: ${runAt}` : '_No runs recorded yet._'}

## Machine

${machineBlock(results)}

## 1. Data consistency

The claim the whole project rests on. Counted in Postgres after each run with a
\`GROUP BY seatId HAVING COUNT(*) > 1\`, not read from Redis or from what the
api reported — whether the locks worked is not a question to put to the locks.

\`naive\` runs with the \`UNIQUE(eventId, seatId)\` index dropped, which is what
a read-then-write checkout looks like without a safety net.

${correctnessTable(results)}

## 2. Performance

p95 is taken from the **checkout endpoint alone**, not across the whole run.
A whole-run comparison would be dishonest: fairqueue buyers also join and poll
a queue, so their request mix differs by design. Checkout is the same endpoint
doing the same database work in both builds, which makes it the only latency
figure worth comparing.

${latencyTable(results)}

${throughputTable(results)}

## 3. Concurrency ceiling

Arrival rate stepped upward in stages until the error rate crossed 50%, at
which point the run aborts. The figure is the highest rate that completed a
full stage, so it is conservative by construction — the true ceiling sits
between it and the next step.

A constant-arrival-rate model rather than a fixed pool of virtual users: a
closed-loop model hides saturation, because a slowing server simply receives
fewer requests.

${ceilingTable(results)}

## 4. Bot resistance

A tenth of the traffic skips the queue and goes straight at hold and checkout,
as fast as it can. The number that matters is not the error rate but the share
of the sale the bots walked away with.

${botTable(results)}

## 5. Kubernetes autoscaling

${scaleSection()}

---

Generated by \`bench/compare.ts\`.
`;

  writeFileSync(path.join(ROOT, 'RESULTS.md'), doc);
  console.log(`  RESULTS.md written from ${results.length} result file(s)`);
}

main();
