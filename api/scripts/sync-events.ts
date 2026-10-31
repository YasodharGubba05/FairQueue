import { PrismaClient } from '@prisma/client';
import { env } from '../src/env';
import { syncEvents } from '../src/events/ingest';

/**
 * `make sync-events` — fetch live events now and store them.
 *
 * Safe to run at any time, including against a database with sales in flight:
 * it refreshes details and creates seats only for events it has never seen.
 */
const prisma = new PrismaClient();

async function main() {
  const report = await syncEvents(prisma, {
    countryCode: env.EVENT_SYNC_COUNTRY,
    limit: env.EVENT_SYNC_LIMIT,
    classification: env.EVENT_SYNC_CLASSIFICATION,
  });

  console.log(`\n[sync] ${report.ranAt}\n`);
  for (const source of report.sources) {
    if (!source.configured) {
      console.log(`  ${source.label.padEnd(20)} not configured — skipped`);
      continue;
    }
    const detail = `fetched ${source.fetched}, created ${source.created}, updated ${source.updated}`;
    console.log(
      `  ${source.label.padEnd(20)} ${detail}${source.failed ? `, failed ${source.failed}` : ''}`,
    );
    if (source.error) console.log(`  ${''.padEnd(20)} error: ${source.error}`);
  }

  const { created, updated, seatsCreated } = report.totals;
  console.log(`\n  ${created} new events, ${updated} refreshed, ${seatsCreated} seats generated`);

  if (created === 0 && updated === 0) {
    console.log(
      '\n  Nothing to sync. Set TICKETMASTER_API_KEY, or add verified entries to\n' +
        '  api/src/events/catalogue.json. FairQueue runs on its seeded events either way.',
    );
  }
  console.log();
}

main()
  .catch((err) => {
    console.error('[sync] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
