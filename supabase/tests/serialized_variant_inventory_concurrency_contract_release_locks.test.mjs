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
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.order_id IS NULL AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' FOR UPDATE"
    ),
    false
  );
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.merchant_id <> p_merchant_id AND vi.status = 'reserved' FOR UPDATE"
    ),
    false
  );
});

test('requires release selectors to lock inventory rows only', () => {
  const selector =
    "FROM variant_inventory vi JOIN product_variants pv ON vi.variant_id = pv.id WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved'";

  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      `${selector} FOR UPDATE`
    ),
    false
  );
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      `${selector} FOR UPDATE OF vi`
    ),
    true
  );
});
