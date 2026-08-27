import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryReleaseLocks } from './serialized_variant_inventory_concurrency_contract_release_locks.mjs';
import { serializedInventoryReleaseTransitions } from './serialized_variant_inventory_concurrency_contract_release_transitions.mjs';

test('release transitions require a scoped lifecycle event', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  assert.ok(
    serializedInventoryReleaseLocks.findReleaseEvent(release, 'available')
  );
  assert.ok(
    serializedInventoryReleaseLocks.findReleaseEvent(release, 'returned')
  );
  const withoutEvents = release.replace(
    /PERFORM\s+private\s*\.\s*record_variant_inventory_event\s*\([\s\S]*?\);\s*/gi,
    ''
  );
  assert.equal(
    serializedInventoryReleaseLocks.findReleaseEvent(
      withoutEvents,
      'available'
    ),
    null
  );
  assert.equal(
    serializedInventoryReleaseLocks.findReleaseEvent(withoutEvents, 'returned'),
    null
  );
  assert.equal(
    serializedInventoryReleaseTransitions.releaseTransition(
      "UPDATE variant_inventory SET status = 'available', order_id = NULL, order_item_id = NULL, reserved_at = NULL, reservation_expires_at = NULL WHERE id = v_unit.id; v_count := v_count + 1;",
      'available'
    ),
    false
  );
});

test('release reconciliation recomputes missing units and deduplicates stock sync', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );

  assert.match(
    release,
    /'missingUnitCount'\s*,\s*GREATEST\(\s*v_item\.quantity\s*-\s*v_reserved_count\s*,\s*0\s*\)/i
  );
  assert.doesNotMatch(
    release,
    /'missingUnitCount'\s*,\s*COALESCE\(\s*\(\s*v_item\.fulfillment_data/i
  );
  assert.match(
    release,
    /array_position\(\s*v_synced_product_ids\s*,\s*v_item\.product_id\s*\)\s+IS\s+NULL[\s\S]*?sync_serialized_stock[\s\S]*?array_append\(\s*v_synced_product_ids\s*,\s*v_item\.product_id\s*\)/i
  );
});
