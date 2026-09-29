import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryDecrements } from './serialized_variant_inventory_concurrency_contract_decrements.mjs';
import { serializedInventoryNullStock } from './serialized_variant_inventory_concurrency_contract_decrement_null_stock.mjs';

const nullStockGuard =
  /IF\s+current_stock\s+IS\s+NULL\s+THEN[\s\S]*?RETURN\s+QUERY\s+SELECT\s+FALSE\s*,\s*NULL::integer\s*,\s*'Insufficient stock'[\s\S]*?RETURN\s*;\s*END\s+IF\s*;/i;

for (const functionName of [
  'public.decrement_product_stock(uuid, integer)',
  'public.decrement_variant_stock(uuid, integer)',
]) {
  test(`${functionName} fails closed for NULL stock`, () => {
    const body = serializedInventoryContract.latestFunctionBody(functionName);

    assert.match(
      body,
      nullStockGuard,
      'managed NULL stock must return a failure before subtraction'
    );
    assert.doesNotMatch(
      body.replace(nullStockGuard, ''),
      nullStockGuard,
      'the regression must cover the exact NULL guard'
    );
  });
}

test('locked prechecks accept a fail-closed NULL stock arm before shortage checks', () => {
  const [decrement] = serializedInventoryDecrements.legacyDecrementMatches(`
    SELECT stock_quantity INTO current_stock
    FROM products WHERE id = product_id_param FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    IF current_stock IS NULL THEN RETURN; END IF;
    IF current_stock < quantity_param THEN RETURN; END IF;
    UPDATE products
    SET stock_quantity = stock_quantity - quantity_param
    WHERE id = product_id_param;
  `);

  assert.equal(
    serializedInventoryDecrements.legacyDecrementHasCompareAndSetGuard(
      decrement[2]
    ),
    true
  );
});

test('null-stock helper rejects a branch without an unconditional exit', () => {
  const source = `
    IF current_stock IS NULL THEN
      IF false THEN RETURN; END IF;
    END IF;
  `;
  const result = serializedInventoryNullStock.inspectNullStockHandler(source, 0);

  assert.ok(result);
  assert.equal(result.valid, false);
});
