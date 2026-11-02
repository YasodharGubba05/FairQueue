import { EVENT_ID, connect, resetSaleState, setIndexForMode, verifyDatabase } from './harness';

/**
 * Put the database back after an interrupted naive run.
 *
 * Naive mode drops the unique index on purpose and then sells seats twice, so
 * a run killed partway through leaves duplicates that Postgres cannot rebuild
 * the index over — which breaks the test suite and leaves the application
 * unable to restore its own last line of defense.
 */
async function main() {
  const { prisma, redis } = connect();
  try {
    await resetSaleState(prisma, redis, EVENT_ID);
    await setIndexForMode(prisma, 'fairqueue');
    const verdict = await verifyDatabase(prisma, EVENT_ID);
    console.log(
      `\n  tickets ${verdict.tickets} · oversold ${verdict.oversoldSeats} · unique index ${
        verdict.uniqueIndexPresent ? 'present' : 'MISSING'
      }\n`,
    );
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
