import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryLocks } from './serialized_variant_inventory_concurrency_contract_locks.mjs';

test('matches reordered lock predicates and targets the order-item alias', () => {
  const source = `
    SELECT 1 FROM public.orders AS o
    WHERE o.merchant_id = p_merchant_id AND o.id = p_order_id
    FOR UPDATE;
    SELECT oi.id
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = p_order_item_id
      AND o.merchant_id = p_merchant_id
      AND o.id = p_order_id
    FOR UPDATE OF oi;
  `;

  const locks = serializedInventoryLocks.findClaimLocks(source);
  assert.ok(locks.order);
  assert.ok(locks.item);
  assert.ok(locks.order.index < locks.item.index);

  const wrongTarget = source.replace('FOR UPDATE OF oi', 'FOR UPDATE OF o');
  assert.equal(
    serializedInventoryLocks.findClaimLocks(wrongTarget).item,
    undefined
  );
});
