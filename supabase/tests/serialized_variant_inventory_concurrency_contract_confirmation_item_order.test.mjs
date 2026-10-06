import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryConfirmation } from './serialized_variant_inventory_concurrency_contract_confirmation.mjs';

const { confirmationItemOrderIsDeterministic, findConfirmationLocks } =
  serializedInventoryConfirmation;

test('confirmation item locks reject inverted product/id ordering', () => {
  const ordered = `
    SELECT oi.id FROM order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.product_id, oi.variant_id, oi.id
    FOR UPDATE;
  `;
  const inverted = ordered.replace(
    'ORDER BY oi.product_id, oi.variant_id, oi.id',
    'ORDER BY oi.id, oi.product_id'
  );
  const obsolete = ordered.replace(
    'ORDER BY oi.product_id, oi.variant_id, oi.id',
    'ORDER BY oi.product_id, oi.id'
  );

  assert.equal(
    confirmationItemOrderIsDeterministic(findConfirmationLocks(ordered).item),
    true
  );
  assert.equal(
    confirmationItemOrderIsDeterministic(findConfirmationLocks(inverted).item),
    false
  );
  assert.equal(
    confirmationItemOrderIsDeterministic(findConfirmationLocks(obsolete).item),
    false
  );
});
