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

test('release transitions stay inside the reserved-unit loop', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  const branches = serializedInventoryContract.extractIfBranches(
    release,
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );
  const update =
    /UPDATE\s+public\.variant_inventory[\s\S]*?WHERE\s+id\s*=\s*v_unit\.id;/i.exec(
      branches.thenBranch
    );
  assert.ok(update);
  const detached = branches.thenBranch
    .replace(update[0], '')
    .replace(/\bFOR\s+v_unit\s+IN\b/i, `${update[0]}\nFOR v_unit IN`);
  assert.equal(
    serializedInventoryReleaseTransitions.releaseTransition(
      detached,
      'available'
    ),
    false
  );
});

test('release preserves fulfillment for items without released units', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  const guard =
    /IF\s+array_position\(\s*v_released_order_item_ids\s*,\s*v_item\.id\s*\)\s+IS\s+NULL\s+THEN\s+CONTINUE\s*;\s*END\s+IF\s*;/i.exec(
      release
    );
  assert.ok(guard);
  assert.equal(
    serializedInventoryReleaseTransitions.releaseReconciliationMatches(
      release.replace(guard[0], '')
    ),
    false
  );
  const loop = /FOR\s+v_item\s+IN[\s\S]*?LOOP\b([\s\S]*?)END\s+LOOP\s*;/i.exec(
    release
  );
  assert.ok(loop);
  const lateGuard = loop[1].replace(guard[0], '') + guard[0];
  assert.equal(
    serializedInventoryReleaseTransitions.releaseReconciliationMatches(
      release.replace(loop[1], lateGuard)
    ),
    false,
    'the preservation guard must dominate every reconciliation operation'
  );
});

test('release authorization raises in the unauthorized branch', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  assert.equal(
    serializedInventoryReleaseLocks.hasMerchantAuthorizationGuard(release),
    true
  );
  const guard = /IF\s+auth\.role\(\)[\s\S]*?END\s+IF\s*;/i.exec(release);
  assert.ok(guard);
  const inverted = guard[0].replace(
    /THEN([\s\S]*?)END\s+IF\s*;$/i,
    'THEN\n    NULL;\n  ELSE$1END IF;'
  );
  assert.equal(
    serializedInventoryReleaseLocks.hasMerchantAuthorizationGuard(
      release.replace(guard[0], inverted)
    ),
    false
  );
});

test('release selects only the inventory columns used by reconciliation', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  assert.doesNotMatch(release, /SELECT\s+vi\.\*/i);
  assert.match(
    release,
    /SELECT\s+vi\.id\s*,\s*vi\.variant_id\s*,\s*vi\.order_item_id\s*,\s*vi\.branch_id\s*,\s*pv\.product_id/i
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
