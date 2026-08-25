import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryDecrements } from './serialized_variant_inventory_concurrency_contract_decrements.mjs';

const {
  legacyDecrementHasCompareAndSetGuard,
  legacyDecrementHasZeroRowHandling,
  legacyDecrementMatches,
} = serializedInventoryDecrements;

test('recognizes quoted lowercase legacy inventory tables', () => {
  const matches = legacyDecrementMatches(
    'UPDATE public."products" SET stock_quantity = stock_quantity - 1 WHERE stock_quantity >= 1;'
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0][1], 'products');
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[0][2]), true);
});

test('recognizes quoted lowercase stock columns', () => {
  const matches = legacyDecrementMatches(`
    UPDATE public.products
    SET "stock_quantity" = "stock_quantity" - 1
    WHERE id = p_product_id AND "stock_quantity" >= 1;
  `);

  assert.equal(matches.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[0][2]), true);
});

test('rejects a locked precheck for a different legacy inventory row', () => {
  const matches = legacyDecrementMatches(`
    SELECT stock_quantity INTO current_stock
    FROM public.products
    WHERE id = product_a
    FOR UPDATE;
    IF current_stock < p_quantity THEN
      RETURN;
    END IF;
    UPDATE public.products
    SET stock_quantity = stock_quantity - p_quantity
    WHERE id = product_b;
  `);

  assert.equal(matches.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[0][2]), false);
  assert.equal(legacyDecrementHasZeroRowHandling(matches[0]), false);
});

test('accepts a locked precheck for the same legacy inventory row', () => {
  const matches = legacyDecrementMatches(`
    SELECT stock_quantity INTO current_stock
    FROM public.product_variants
    WHERE id = variant_id_param
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    IF current_stock < quantity_param THEN
      RETURN;
    END IF;
    UPDATE public.product_variants
    SET stock_quantity = stock_quantity - quantity_param
    WHERE id = variant_id_param;
  `);

  assert.equal(matches.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[0][2]), true);
  assert.equal(legacyDecrementHasZeroRowHandling(matches[0]), true);
});

test('rejects a locked precheck that does not handle a missing row', () => {
  const matches = legacyDecrementMatches(`
    SELECT stock_quantity INTO current_stock FROM products WHERE id = product_id FOR UPDATE;
    IF current_stock < p_quantity THEN RETURN; END IF;
    UPDATE products SET stock_quantity = stock_quantity - p_quantity WHERE id = product_id;
  `);
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[0][2]), false);
  assert.equal(legacyDecrementHasZeroRowHandling(matches[0]), false);
});

test('scans every decrement inside a data-modifying CTE statement', () => {
  const matches = legacyDecrementMatches(`
    WITH changed AS (
      UPDATE products
      SET stock_quantity = stock_quantity - p_quantity
      WHERE id = p_first_id
      RETURNING id
    )
    UPDATE products
    SET stock_quantity = stock_quantity - p_quantity
    WHERE id = p_second_id AND stock_quantity >= p_quantity;
  `);

  assert.equal(matches.length, 2);
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[0][2]), false);
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[1][2]), true);
});

test('binds compare-and-set stock bounds to the updated table', () => {
  const matches = legacyDecrementMatches(`
    UPDATE products AS p
    SET stock_quantity = p.stock_quantity - quantity_param
    FROM product_variants AS pv
    WHERE p.id = product_id_param AND pv.stock_quantity >= quantity_param;
  `);
  assert.equal(matches.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[0][2]), false);
});

test('binds stock bounds to the complete decrement expression', () => {
  const matches = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = stock_quantity - quantity_param * 2
    WHERE id = product_id_param AND stock_quantity >= quantity_param;
    IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_stock'; END IF;
  `);
  assert.equal(matches.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[0][2]), false);
});

test('rejects stock bounds supplied only by dollar-quoted literals', () => {
  const matches = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = stock_quantity - quantity_param
    WHERE id = product_id_param
      AND note = $$stock_quantity >= quantity_param$$;
  `);
  assert.equal(matches.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[0][2]), false);
});
