import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../migrations/20261127121000_bound_timeout_loyalty_lookup.sql',
    import.meta.url
  ),
  'utf8'
);

test('timeout cleanup probes loyalty claims by each candidate order', () => {
  assert.doesNotMatch(migration, /loyalty_orders\s+AS\s+MATERIALIZED/i);
  assert.match(
    migration,
    /NOT EXISTS\s*\(\s*SELECT 1 FROM public\.reward_redemptions l\s+WHERE l\.used_on_order_id = c\.id/s
  );
});
