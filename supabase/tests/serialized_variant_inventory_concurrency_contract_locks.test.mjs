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

  const wrongOrderAlias = source.replace(
    'AND o.id = p_order_id\n    FOR UPDATE OF oi',
    'AND oi.id = p_order_id\n    FOR UPDATE OF oi'
  );
  assert.equal(
    serializedInventoryLocks.findClaimLocks(wrongOrderAlias).item,
    undefined
  );

  const skippedOrder = source.replace('FOR UPDATE;', 'FOR UPDATE SKIP LOCKED;');
  assert.equal(
    serializedInventoryLocks.findClaimLocks(skippedOrder).order,
    undefined
  );

  const skippedItem = source.replace(
    'FOR UPDATE OF oi;',
    'FOR UPDATE OF oi SKIP LOCKED;'
  );
  assert.equal(
    serializedInventoryLocks.findClaimLocks(skippedItem).item,
    undefined
  );

  const nowaitOrder = source.replace('FOR UPDATE;', 'FOR UPDATE NOWAIT;');
  assert.equal(
    serializedInventoryLocks.findClaimLocks(nowaitOrder).order,
    undefined
  );

  const nowaitItem = source.replace(
    'FOR UPDATE OF oi;',
    'FOR UPDATE OF oi NOWAIT;'
  );
  assert.equal(
    serializedInventoryLocks.findClaimLocks(nowaitItem).item,
    undefined
  );
});
