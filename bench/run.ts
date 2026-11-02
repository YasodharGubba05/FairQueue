import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  EVENT_ID, connect, machineSpec, resetSaleState, setIndexForMode, verifyDatabase,
} from './harness';

/**
 * One benchmark run, start to finish.
 *
 *   bench/run.ts <scenario> <mode>
 *
 * The orchestrator owns the api process rather than assuming one is already
 * running, because the mode is read from the environment at boot. Starting it
 * here is the only way to be certain both runs were produced by a server in
 * the mode the result file claims.
 *
 * Everything else exists to make the two modes comparable: the same reset, the
 * same workload parameters, the same machine, and a verdict read from Postgres
 * afterwards rather than taken from what the api said it did.
 */
const SCENARIOS = ['flash-sale', 'hot-seats', 'bots', 'breaking-point'] as const;
type Scenario = (typeof SCENARIOS)[number];
type Mode = 'naive' | 'fairqueue';

const ROOT = path.resolve(__dirname, '..');
const RESULTS = path.join(ROOT, 'bench', 'results');
const API_PORT = Number(process.env.BENCH_API_PORT ?? 4010);
const API_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * Identical for both modes, and recorded in the result file.
 *
 * Kept modest so a run finishes on a laptop. The absolute numbers matter less
 * than the comparison, and a workload that exhausts the load generator
 * measures k6 rather than FairQueue.
 */
const WORKLOAD: Record<Scenario, Record<string, string>> = {
  'flash-sale': { BUYERS: '400', PEAK_VUS: '200' },
  'hot-seats': { BUYERS: '200', PEAK_VUS: '120', ITERATIONS: '1200', HOT_SEATS: '50' },
  bots: { BUYERS: '300', PEAK_VUS: '150', BOT_SHARE: '0.1' },
  'breaking-point': {
    BUYERS: '300', START_RATE: '50', STEP: '100', STEPS: '6', STAGE_SECONDS: '15',
  },
};

function log(message: string) {
  console.log(`  ${message}`);
}

async function waitForApi(timeoutMs = 40_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${API_URL}/readyz`);
      if (res.ok) return true;
    } catch {
      // Still starting.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Boot an api in the given mode, on its own port, with the sync switched off. */
function startApi(mode: Mode): ChildProcess {
  return spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.join(ROOT, 'api'),
    env: {
      ...process.env,
      MODE: mode,
      API_PORT: String(API_PORT),
      POD_NAME: `bench-${mode}`,
      // Every virtual user shares the load generator's address, the same shape
      // of problem as an office behind one NAT. The per-account limit — the one
      // that actually costs a bot something — is left exactly as it ships.
      RATE_LIMIT_IP_FACTOR: '1000000',
      // A provider call must never land inside a measured window.
      EVENT_SYNC_INTERVAL_MINUTES: '0',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function main() {
  const [scenario, mode] = process.argv.slice(2) as [Scenario, Mode];

  if (!SCENARIOS.includes(scenario) || !['naive', 'fairqueue'].includes(mode)) {
    console.error(`usage: tsx bench/run.ts <${SCENARIOS.join('|')}> <naive|fairqueue>`);
    process.exit(1);
  }

  if (!existsSync(RESULTS)) mkdirSync(RESULTS, { recursive: true });

  const { prisma, redis } = connect();
  let api: ChildProcess | null = null;

  try {
    console.log(`\n=== ${scenario} · ${mode} ===\n`);

    log('resetting sale state');
    // Order matters: the tickets have to go before the index can be rebuilt
    // over them, and naive runs leave duplicates behind.
    await resetSaleState(prisma, redis, EVENT_ID);
    await setIndexForMode(prisma, mode);

    const before = await verifyDatabase(prisma, EVENT_ID);
    if (before.tickets !== 0) throw new Error('reset failed: tickets remain');
    log(`clean start · unique index ${before.uniqueIndexPresent ? 'present' : 'dropped'}`);

    log(`starting api in ${mode} mode on :${API_PORT}`);
    api = startApi(mode);
    const apiLog: string[] = [];
    api.stdout?.on('data', (d) => apiLog.push(d.toString()));
    api.stderr?.on('data', (d) => apiLog.push(d.toString()));

    if (!(await waitForApi())) {
      throw new Error(`api did not become ready:\n${apiLog.join('').slice(-800)}`);
    }

    const reportedMode = await fetch(`${API_URL}/api/mode`).then((r) => r.json());
    if (reportedMode.mode !== mode) {
      throw new Error(`api reports mode=${reportedMode.mode}, expected ${mode}`);
    }
    log(`api ready and reporting mode=${reportedMode.mode}`);

    const spec = await machineSpec(prisma, redis);
    const workload = WORKLOAD[scenario];

    log('running k6');
    const startedAt = new Date();
    const k6 = spawn('k6', ['run', `bench/${scenario}.js`], {
      cwd: ROOT,
      env: { ...process.env, ...workload, API_URL, EVENT_ID, MODE_LABEL: mode },
      stdio: 'inherit',
    });
    const k6Code = await new Promise<number>((resolve) => k6.on('close', (c) => resolve(c ?? 1)));
    const finishedAt = new Date();

    // A non-zero exit from an aborting threshold is a finding, not a failure.
    if (k6Code !== 0) log(`k6 exited ${k6Code} (a tripped threshold counts as a result)`);

    log('verifying against postgres');
    const verdict = await verifyDatabase(prisma, EVENT_ID);

    const k6Path = path.join(RESULTS, `${scenario}-${mode}.k6.json`);
    const k6Summary = existsSync(k6Path) ? JSON.parse(readFileSync(k6Path, 'utf8')) : null;

    const result = {
      scenario,
      mode,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      machine: spec,
      workload: { ...workload, eventId: EVENT_ID },
      k6: k6Summary,
      database: verdict,
    };

    const out = path.join(RESULTS, `${scenario}-${mode}.json`);
    writeFileSync(out, JSON.stringify(result, null, 2));

    console.log('');
    log(`purchases       ${k6Summary?.outcomes?.purchases ?? '?'}`);
    log(`tickets in db   ${verdict.tickets}`);
    log(`distinct seats  ${verdict.distinctSeatsSold}`);
    log(`oversold seats  ${verdict.oversoldSeats}`);
    log(`duplicate tix   ${verdict.duplicateTickets}`);
    log(`p95 checkout    ${k6Summary?.latencyMs?.p95Checkout ?? '?'} ms`);
    console.log(`\n  written to ${path.relative(ROOT, out)}\n`);

    // A naive run deliberately leaves duplicate tickets and a dropped unique
    // index behind, which breaks the test suite and leaves the application
    // unable to rebuild its own safety net. The verdict is already captured in
    // the result file above — which is the only place any published number may
    // come from — so the database is put back to a correct state here.
    log('restoring the database');
    await resetSaleState(prisma, redis, EVENT_ID);
    await setIndexForMode(prisma, 'fairqueue');
    const after = await verifyDatabase(prisma, EVENT_ID);
    if (!after.uniqueIndexPresent) {
      console.warn('  WARNING: could not rebuild the unique index');
    } else {
      log('unique index rebuilt · database clean');
    }
    console.log('');
  } finally {
    if (api) {
      api.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 800));
      if (!api.killed) api.kill('SIGKILL');
    }
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error(`\n  benchmark failed: ${(err as Error).message}\n`);
  process.exit(1);
});
