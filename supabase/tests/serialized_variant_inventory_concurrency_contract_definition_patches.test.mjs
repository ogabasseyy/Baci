import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryDefinitionPatches } from './serialized_variant_inventory_concurrency_contract_definition_patches.mjs';

const migrationsDir = path.resolve(import.meta.dirname, '..', 'migrations');

test('definition patch table matches the checked-in migrations', () => {
  for (const patch of serializedInventoryDefinitionPatches.definitionPatches) {
    const migration = fs.readFileSync(
      path.join(migrationsDir, patch.migration),
      'utf8'
    );
    assert.ok(
      migration.includes(patch.old),
      `${patch.migration} must contain the registered old fragment`
    );
    assert.ok(
      migration.includes(patch.new),
      `${patch.migration} must contain the registered new fragment`
    );
    for (const target of patch.functions) {
      assert.ok(
        migration.includes(target.proname),
        `${patch.migration} must target ${target.proname}`
      );
      if (target.pronargs !== null) {
        assert.ok(
          migration.includes(`pronargs = ${target.pronargs}`),
          `${patch.migration} must target ${target.proname} with ${target.pronargs} args`
        );
      }
    }
  }
});

test('latest function bodies include the deployed ordering patches', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  assert.match(release, /ORDER BY pv\.product_id, vi\.variant_id, vi\.id/);
  assert.match(release, /ORDER BY oi\.product_id, oi\.variant_id, oi\.id/);
  assert.equal(release.includes('ORDER BY pv.product_id, vi.id'), false);
  assert.equal(release.includes('ORDER BY oi.product_id, oi.id'), false);
  const sold = serializedInventoryContract.latestFunctionBody(
    'private.mark_order_inventory_units_sold(uuid, uuid)'
  );
  assert.match(sold, /ORDER BY pv\.product_id, vi\.variant_id, vi\.id/);
  const confirm = serializedInventoryContract.latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  assert.match(confirm, /ORDER BY oi\.product_id, oi\.variant_id, oi\.id/);
});
