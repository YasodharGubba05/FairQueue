import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://fairqueue:fairqueue@localhost:5432/fairqueue?schema=public';
}

import { PrismaClient } from '../api/node_modules/@prisma/client';

const prisma = new PrismaClient();
const PORT = 4001;
const API_URL = `http://127.0.0.1:${PORT}`;

async function waitForHealth(url: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return true;
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  console.log('[bench] preparing database for naive hot-seats benchmark...');

  // Reset tickets and orders for clean benchmark
  await prisma.ticket.deleteMany({ where: { eventId: 'evt_headline' } });
  await prisma.order.deleteMany({ where: { eventId: 'evt_headline' } });

  // In naive mode: drop unique index to simulate naive system without constraint
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Ticket_eventId_seatId_key"`);

  console.log('[bench] starting api in MODE=naive on port', PORT);
  const apiProc: ChildProcess = spawn(
    './api/node_modules/.bin/tsx',
    ['api/src/index.ts'],
    {
      env: {
        ...process.env,
        MODE: 'naive',
        API_PORT: String(PORT),
        DATABASE_URL:
          process.env.DATABASE_URL ||
          'postgresql://fairqueue:fairqueue@localhost:5432/fairqueue?schema=public',
        REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
      },
      stdio: 'pipe',
    }
  );

  apiProc.stdout?.on('data', (d) => {
    const s = d.toString();
    if (s.includes('listening')) console.log('[api-log]', s.trim());
  });

  apiProc.stderr?.on('data', (d) => {
    console.error('[api-err]', d.toString().trim());
  });

  const healthy = await waitForHealth(API_URL);
  if (!healthy) {
    console.error('[bench] api failed to become healthy');
    apiProc.kill();
    process.exit(1);
  }
  console.log('[bench] api is healthy in naive mode!');

  const summaryPath = resolve(__dirname, 'results/k6-summary.json');
  console.log('[bench] executing k6 hot-seats benchmark...');

  await new Promise<void>((done, reject) => {
    const k6 = spawn(
      '/opt/homebrew/bin/k6',
      [
        'run',
        'bench/hot-seats.js',
        '-e',
        `API_URL=${API_URL}`,
        '--summary-export',
        summaryPath,
      ],
      { stdio: 'inherit' }
    );

    k6.on('exit', (code) => {
      if (code === 0) done();
      else reject(new Error(`k6 exited with code ${code}`));
    });
  });

  // Query database metrics
  const duplicateSeats: Array<{ seatId: string; count: bigint }> =
    await prisma.$queryRaw`
      SELECT "seatId", count(*) as count
      FROM "Ticket"
      WHERE "eventId" = 'evt_headline'
      GROUP BY "seatId"
      HAVING count(*) > 1
    `;

  const totalTickets = await prisma.ticket.count({
    where: { eventId: 'evt_headline' },
  });
  const totalOrders = await prisma.order.count({
    where: { eventId: 'evt_headline' },
  });

  const oversoldSeatsCount = duplicateSeats.length;
  const duplicateTicketsCount = duplicateSeats.reduce(
    (acc, row) => acc + (Number(row.count) - 1),
    0
  );

  // Read k6 summary
  let p95Latency = 0;
  let errorRate = 0;
  let totalRequests = 0;
  let reqsPerSec = 0;

  try {
    const k6Summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));
    const dur = k6Summary.metrics?.http_req_duration;
    p95Latency = dur?.['p(95)'] ?? dur?.values?.['p(95)'] ?? 0;

    const failed = k6Summary.metrics?.http_req_failed;
    errorRate = failed?.value ?? failed?.rate ?? failed?.values?.rate ?? 0;

    const reqs = k6Summary.metrics?.http_reqs;
    totalRequests = reqs?.count ?? reqs?.values?.count ?? 0;
    reqsPerSec = reqs?.rate ?? reqs?.values?.rate ?? 0;
  } catch (err) {
    console.warn('[bench] could not parse k6 summary:', (err as Error).message);
  }

  const result = {
    test: 'hot-seats',
    mode: 'naive',
    timestamp: new Date().toISOString(),
    concurrency_vus: 100,
    iterations: 500,
    target_seats: 50,
    total_requests: totalRequests,
    requests_per_sec: Math.round(reqsPerSec * 10) / 10,
    p95_latency_ms: Math.round(p95Latency * 10) / 10,
    http_error_rate: Math.round(errorRate * 1000) / 1000,
    total_orders_created: totalOrders,
    total_tickets_created: totalTickets,
    oversold_seats: oversoldSeatsCount,
    duplicate_tickets: duplicateTicketsCount,
  };

  const outputPath = resolve(__dirname, 'results/naive-hot-seats.json');
  writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log('\n================ BENCHMARK RESULT (NAIVE MODE) ================');
  console.log(`Requests:             ${result.total_requests} (${result.requests_per_sec} req/s)`);
  console.log(`p95 Latency:          ${result.p95_latency_ms} ms`);
  console.log(`HTTP Error Rate:      ${(result.http_error_rate * 100).toFixed(1)}% (mostly 409 conflict when seats sold out)`);
  console.log(`Total Orders:         ${result.total_orders_created}`);
  console.log(`Total Tickets:        ${result.total_tickets_created}`);
  console.log(`Target Seats:         ${result.target_seats}`);
  console.log(`Oversold Seats (DB):  ${result.oversold_seats} SEATS SOLD MULTIPLE TIMES!`);
  console.log(`Duplicate Tickets:    ${result.duplicate_tickets}`);
  console.log(`Saved to:             ${outputPath}`);
  console.log('===============================================================\n');

  apiProc.kill();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[bench] failed:', err);
  process.exit(1);
});
