import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryConfirmation } from './serialized_variant_inventory_concurrency_contract_confirmation.mjs';

const { findConfirmationLocks } = serializedInventoryConfirmation;

test('confirmation locks require mandatory tenant and order scopes', () => {
  const valid = `
    SELECT 1 FROM orders o WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id FOR UPDATE;
    SELECT oi.id FROM order_items oi WHERE oi.order_id = p_order_id FOR UPDATE;
  `;
  assert.ok(findConfirmationLocks(valid).order);
  assert.ok(findConfirmationLocks(valid).item);
  assert.equal(
    findConfirmationLocks(
      valid.replace(
        'oi.order_id = p_order_id',
        'oi.order_id = p_order_id OR true'
      )
    ).item,
    undefined
  );
  assert.equal(
    findConfirmationLocks(
      valid.replace('o.id = p_order_id', 'o.id = p_order_id OR true')
    ).order,
    undefined
  );
  assert.equal(
    findConfirmationLocks(
      valid.replace(
        'FOR UPDATE;',
        'AND EXISTS (SELECT 1 FROM merchants m WHERE m.id = o.merchant_id FOR UPDATE);'
      )
    ).order,
    undefined
  );
  assert.equal(
    findConfirmationLocks(
      valid.replace(
        'WHERE oi.order_id = p_order_id FOR UPDATE',
        'WHERE oi.order_id = p_order_id LIMIT 1 FOR UPDATE'
      )
    ).item,
    undefined
  );
});
