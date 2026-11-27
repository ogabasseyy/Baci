import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../migrations/20261127124000_close_timeout_identity_lock_gaps.sql',
    import.meta.url
  ),
  'utf8'
);

test('timeout cleanup snapshots loyalty claims before cancellation can release them', () => {
  const snapshot = migration.indexOf('INTO v_loyalty_order_ids');
  const cancellation = migration.indexOf('UPDATE public.orders o');
  assert.ok(snapshot >= 0 && cancellation > snapshot);
  assert.match(
    migration,
    /NOT \(c\.id = ANY\(v_loyalty_order_ids\)\)/
  );
  const candidateQuery = migration.slice(migration.indexOf('INTO v_candidate_ids'), snapshot);
  assert.match(candidateQuery, /public\.oxygen_workflows/);
  assert.match(candidateQuery, /public\.reconciliation_review/);
});
