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
