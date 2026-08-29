import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { serializedInventoryFixtureFunctions } from './serialized_variant_inventory_concurrency_fixture_functions.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('extracts the current claim and confirmation functions as complete SQL statements', () => {
  const sql = serializedInventoryFixtureFunctions.fixtureFunctionSql(repoRoot);

  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 4);
  assert.match(
    sql,
    /private\.claim_variant_inventory_units_for_order_item_internal[\s\S]*?FOR UPDATE SKIP LOCKED/i
  );
  assert.match(
    sql,
    /private\.confirm_order_inventory_reservations[\s\S]*?ORDER BY oi\.product_id, oi\.id[\s\S]*?FOR UPDATE/i
  );
  assert.match(
    sql,
    /public\.claim_variant_inventory_units_for_order_item[\s\S]*?private\.claim_variant_inventory_units_for_order_item_internal/i
  );
  assert.match(
    sql,
    /public\.confirm_order_inventory_reservations[\s\S]*?private\.confirm_order_inventory_reservations/i
  );
  assert.equal(sql.trimEnd().endsWith(';'), true);
});
