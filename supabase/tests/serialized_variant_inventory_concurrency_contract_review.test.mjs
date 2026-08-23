import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryAvailability } from './serialized_variant_inventory_concurrency_contract_availability.mjs';

const {
  latestFunctionBody,
  extractIfBranches,
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

test('distinguishes scalar and array function argument types', () => {
  const source = [
    'CREATE FUNCTION private.fixture(p_value uuid[]) RETURNS void AS $$',
    'BEGIN',
    "  RAISE EXCEPTION 'array overload';",
    'END;',
    '$$;',
    'CREATE FUNCTION private.fixture(p_value uuid) RETURNS void AS $$',
    'BEGIN',
    "  RAISE EXCEPTION 'scalar overload';",
    'END;',
    '$$;',
  ].join('\n');

  const scalar = latestFunctionBody('private.fixture(uuid)', [source]);
  assert.match(scalar, /scalar overload/);
  assert.doesNotMatch(scalar, /array overload/);
});

test('accepts same-line dollar-quote terminators', () => {
  const source = [
    'CREATE FUNCTION private.fixture(integer) RETURNS void AS $$',
    'BEGIN',
    "  RAISE NOTICE 'semi; $$;'; NULL; END; $$ LANGUAGE plpgsql;",
  ].join('\n');

  assert.match(
    latestFunctionBody('private.fixture(integer)', [source]),
    /semi; \$\$;/
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

  const negated = unsafe.replace(
    'unit.merchant_id = p_merchant_id',
    'NOT (unit.merchant_id = p_merchant_id)'
  );
  assert.equal(
    serializedInventoryAvailability.availableUnitPredicatesMatch(
      negated,
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

  const negated = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE NOT (stock_quantity >= stock_rec.total_quantity);
  `);
  assert.equal(negated.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(negated[0][2]), false);
});

test('does not mistake CASE ELSE for the target IF branch', () => {
  const branches = extractIfBranches(
    [
      "IF v_target_status = 'available' THEN",
      '  v_label := CASE v_state',
      "    WHEN 'ready' THEN 'ready'",
      "    ELSE 'other'",
      '  END CASE;',
      '  PERFORM lock_available_units();',
      'ELSE',
      '  PERFORM release_reserved_units();',
      'END IF;',
    ].join('\n'),
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );

  assert.match(branches.thenBranch, /lock_available_units/);
  assert.match(branches.elseBranch, /release_reserved_units/);
});
