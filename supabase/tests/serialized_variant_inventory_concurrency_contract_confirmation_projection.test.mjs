import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';

test('confirmation item locks project only consumed columns', () => {
  const confirm = serializedInventoryContract.latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );

  assert.match(
    confirm,
    /FOR\s+v_item\s+IN\s+SELECT\s+oi\.id\s*,\s*oi\.product_id\s*,\s*oi\.variant_id\s*,\s*oi\.quantity\s+FROM\s+public\.order_items\s+oi/i,
    'confirmation should project only the item fields consumed by the loop'
  );
  assert.doesNotMatch(
    confirm,
    /FOR\s+v_item\s+IN\s+SELECT\s+oi\.\*/i,
    'confirmation should not materialize every order-item column'
  );
});

test('confirmation replay does not re-emit units whose reservation is already durable', () => {
  const confirm = serializedInventoryContract.latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  const fullyReservedBranch =
    /IF\s+v_reserved_count\s*=\s*v_item\.quantity\s+THEN([\s\S]*?)\bELSE\b/i.exec(
      confirm
    );
  assert.ok(fullyReservedBranch);
  assert.match(
    confirm,
    /v_newly_confirmed_unit_ids\s+uuid\[\]/i,
    'confirmation should track units newly made durable'
  );
  assert.match(
    fullyReservedBranch[1],
    /reservation_expires_at\s+IS\s+NOT\s+NULL/i,
    'replay must exclude units whose reservation expiry is already NULL'
  );
  assert.match(
    fullyReservedBranch[1],
    /WHERE\s+id\s*=\s*ANY\s*\(\s*v_newly_confirmed_unit_ids\s*\)/i,
    'hold-confirmed events should be emitted only for newly durable units'
  );
  assert.doesNotMatch(
    fullyReservedBranch[1],
    /FOR\s+v_unit\s+IN\s+SELECT\s+id\s+FROM\s+public\.variant_inventory\s+WHERE\s+order_item_id\s*=\s*v_item\.id\s+AND\s+status\s*=\s*'reserved'/i,
    'replay must not emit events for every reserved unit'
  );
});
