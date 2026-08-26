import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryReleaseLocks } from './serialized_variant_inventory_concurrency_contract_release_locks.mjs';

test('rejects unsatisfiable reserved-unit release selectors', () => {
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' AND false FOR UPDATE"
    ),
    false
  );
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' AND vi.status <> 'reserved' FOR UPDATE"
    ),
    false
  );
});
