import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suites share one Postgres, and the naive suite deliberately drops the
    // UNIQUE(eventId, seatId) index to let itself double-sell. An index is
    // schema-wide, so suites must not run at the same time or they would be
    // fighting over whether the backstop exists.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
