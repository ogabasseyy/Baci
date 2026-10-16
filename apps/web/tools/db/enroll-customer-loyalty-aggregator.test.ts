import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const TESTS_DIR = path.join(REPOSITORY_ROOT, 'supabase/migrations/tests');
const AGGREGATOR = 'enroll_customer_loyalty.sql';
// Standalone suites run as their own CI --sql-check entries (the
// concurrency file needs two live dblink sessions and cannot be a
// transaction part).
const STANDALONE = new Set([
  AGGREGATOR,
  'enroll_customer_loyalty_concurrency.sql',
]);

describe('loyalty SQL aggregator wiring', () => {
  it('includes every sibling suite as a part', async () => {
    // CI executes the aggregator as one --sql-check; every other
    // enroll_customer_loyalty*.sql suite must be a \ir part of it or
    // it silently never runs (the parts share one transaction and
    // cannot be wired as standalone checks).
    const entries = (await readdir(TESTS_DIR))
      .filter(
        (name) =>
          name.startsWith('enroll_customer_loyalty') &&
          name.endsWith('.sql') &&
          !STANDALONE.has(name)
      )
      .sort();
    const aggregator = await readFile(path.join(TESTS_DIR, AGGREGATOR), 'utf8');
    const included = new Set(
      [...aggregator.matchAll(/\\ir\s+(\S+\.sql)/g)].map((match) =>
        path.basename(match[1])
      )
    );

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(included.has(entry), `${entry} is not wired`).toBe(true);
    }
  });
});
