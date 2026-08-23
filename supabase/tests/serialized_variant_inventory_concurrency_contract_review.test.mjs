import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryAvailability } from './serialized_variant_inventory_concurrency_contract_availability.mjs';

const {
  latestFunctionBody,
  legacyDecrementHasCompareAndSetGuard,
  legacyDecrementMatches,
} = serializedInventoryContract;

test('resolves quoted function replacements and public confirmation delegation', () => {
  const quoted = latestFunctionBody('private.fixture(integer)', [
    [
      'CREATE OR REPLACE FUNCTION "private"."fixture"(p_value integer) RETURNS void AS $$',
      'BEGIN',
      "  RAISE EXCEPTION 'quoted replacement';",
      'END;',
      '$$;',
    ].join('\n'),
  ]);
  assert.match(quoted, /quoted replacement/);

  const publicBody = latestFunctionBody(
    'public.confirm_order_inventory_reservations(uuid, uuid)'
  );
  assert.match(
    publicBody,
    /RETURN\s+private\.confirm_order_inventory_reservations\s*\(\s*p_merchant_id\s*,\s*p_order_id\s*\)/i
  );
});

test('requires each availability scope predicate as an AND-conjunct', () => {
  const unsafe = `
    SELECT unit.id
    FROM public.variant_inventory AS unit
    WHERE (unit.merchant_id = p_merchant_id OR unit.variant_id = v_variant_id)
      AND unit.status = 'available'
      AND unit.order_id IS NULL
      AND unit.order_item_id IS NULL
      AND unit.sold_at IS NULL
    ORDER BY unit.id
    LIMIT v_needed FOR UPDATE SKIP LOCKED;
  `;
  assert.equal(
    serializedInventoryAvailability.availableUnitPredicatesMatch(
      unsafe,
      'v_variant_id'
    ),
    false
  );
});

test('accepts unrelated disjunctions when the stock bound remains conjunctive', () => {
  const matches = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE (id = stock_rec.product_id OR legacy_id = stock_rec.product_id)
      AND stock_quantity >= stock_rec.total_quantity;
  `);

  assert.equal(matches.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[0][2]), true);
});
