/**
 * Test files (relative to apps/web) that Vitest starts first, in this order,
 * ahead of every other test file. vitest.sequencer.ts applies the list; it only
 * changes the order inside a run or a CI shard, never which files run or which
 * shard they land in.
 *
 * Why: a worker runs one test file at a time and Vitest hands files out in a
 * fixed order. CI has no Vitest results cache, so the default order is "project
 * name, then file size". A few tiny files hold a test that runs for minutes (a
 * whole-repository scan), so they started last and ran alone at the end of
 * their shard while the other workers sat idle. Starting them first lets the
 * other workers fill the time with the many short files instead.
 *
 * Add a file only when it takes more than about 30 s inside a CI shard and does
 * not depend on test order. Keep the list short and longest first: the first
 * entries start together, one per worker. Durations are from the hosted web
 * shards of CI run 42946728461 (3 workers per shard, Vitest 4.1.12).
 * tests/vitest-projects/slow-test-files.test.ts fails when an entry no longer
 * exists, so a rename cannot silently drop a file out of the list.
 */
export const SLOW_TEST_FILES_FIRST: readonly string[] = [
  // Whole-repository TypeScript scan: 148-182 s, one test.
  'tools/events/verify-event-pipeline-boundaries.live.test.ts',
  // Repository scan: 75-102 s.
  'tools/events/verify-analytics-delivery-authority.repository.test.ts',
  // About 54 s each.
  'mcp-server/server-output-schema.test.ts',
  'tools/db/verify-supabase-history-replay-manifest.test.ts',
];
