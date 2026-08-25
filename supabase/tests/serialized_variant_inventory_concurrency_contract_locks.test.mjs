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

  const disconnectedJoin = source.replace('ON o.id = oi.order_id', 'ON true');
  assert.equal(
    serializedInventoryLocks.findClaimLocks(disconnectedJoin).item,
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

  const literalDecoys = source
    .replace('FOR UPDATE;', "AND 'FOR UPDATE' = 'FOR UPDATE';")
    .replace('FOR UPDATE OF oi;', "AND 'FOR UPDATE' = 'FOR UPDATE';");
  assert.equal(
    serializedInventoryLocks.findClaimLocks(literalDecoys).order,
    undefined
  );
  assert.equal(
    serializedInventoryLocks.findClaimLocks(literalDecoys).item,
    undefined
  );

  const nestedLockDecoy = source.replace(
    'FOR UPDATE;',
    'AND EXISTS (SELECT 1 FROM merchants m WHERE m.id = o.merchant_id FOR UPDATE);'
  );
  assert.equal(
    serializedInventoryLocks.findClaimLocks(nestedLockDecoy).order,
    undefined
  );
});

test('claim locks must dominate the available-unit selector', () => {
  const locks = `
    PERFORM 1 FROM public.orders
    WHERE id = p_order_id AND merchant_id = p_merchant_id FOR UPDATE;
    SELECT oi.id FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = p_order_item_id AND o.id = p_order_id
      AND o.merchant_id = p_merchant_id FOR UPDATE OF oi;
  `;
  const selector = `
    SELECT vi.id FROM public.variant_inventory vi
    WHERE vi.merchant_id = p_merchant_id AND vi.variant_id = v_variant_id
      AND vi.status = 'available' AND vi.order_id IS NULL
      AND vi.order_item_id IS NULL AND vi.sold_at IS NULL
    ORDER BY vi.id LIMIT v_needed FOR UPDATE SKIP LOCKED;
  `;
  assert.equal(
    serializedInventoryLocks.claimLocksDominateSelector(`${locks}${selector}`),
    true
  );
  assert.equal(
    serializedInventoryLocks.claimLocksDominateSelector(
      `IF false THEN\n${locks}\nEND IF;\n${selector}`
    ),
    false
  );
  assert.equal(
    serializedInventoryLocks.claimLocksDominateSelector(
      `WHILE false LOOP\n${locks}\nEND LOOP;\n${selector}`
    ),
    false
  );
  assert.equal(
    serializedInventoryLocks.claimLocksDominateSelector(
      `BEGIN\nNULL;\nEXCEPTION WHEN OTHERS THEN\n${locks}\nEND;\n${selector}`
    ),
    false
  );
});
