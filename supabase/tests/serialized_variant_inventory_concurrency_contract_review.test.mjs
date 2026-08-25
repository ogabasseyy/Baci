import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryAvailability } from './serialized_variant_inventory_concurrency_contract_availability.mjs';

const {
  functionBody,
  latestFunctionBody,
  legacyDecrementHasCompareAndSetGuard,
  legacyDecrementHasZeroRowHandling,
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

test('invalidates a function body after an ALTER FUNCTION rename', () => {
  const source = [
    'CREATE FUNCTION private.fixture(integer) RETURNS void AS $$',
    'BEGIN',
    '  NULL;',
    'END;',
    '$$;',
    'ALTER FUNCTION private.fixture(integer) RENAME TO fixture_old;',
  ].join('\n');

  assert.throws(
    () => latestFunctionBody('private.fixture(integer)', [source]),
    /missing private\.fixture/
  );
});

test('invalidates a function body after an ALTER FUNCTION schema move', () => {
  const source = [
    'CREATE FUNCTION private.fixture(integer) RETURNS void AS $$',
    'BEGIN',
    '  NULL;',
    'END;',
    '$$;',
    'ALTER FUNCTION private.fixture(integer) SET SCHEMA public;',
  ].join('\n');

  assert.throws(
    () => latestFunctionBody('private.fixture(integer)', [source]),
    /missing private\.fixture/
  );
});

test('ignores function markers embedded in SQL string literals', () => {
  const source = [
    'CREATE FUNCTION private.fixture(integer) RETURNS void AS $$',
    'BEGIN',
    '  NULL;',
    'END;',
    '$$;',
    "COMMENT ON FUNCTION private.fixture(integer) IS 'CREATE FUNCTION private.fixture(integer) RETURNS void AS $$ BEGIN RAISE EXCEPTION ''fake''; END; $$;';",
  ].join('\n');

  const body = latestFunctionBody('private.fixture(integer)', [source]);
  assert.match(body, /NULL/);
  assert.doesNotMatch(body, /fake/);
  assert.match(functionBody(source, 'private.fixture(integer)'), /NULL/);
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

  const postfixNegated = unsafe.replace(
    'unit.merchant_id = p_merchant_id',
    '(unit.merchant_id = p_merchant_id) IS FALSE'
  );
  assert.equal(
    serializedInventoryAvailability.availableUnitPredicatesMatch(
      postfixNegated,
      'v_variant_id'
    ),
    false
  );
});

test('requires the item shortfall predicate for payment-loss reporting', () => {
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  const paymentLossGuard =
    /IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+AND\s+v_reserved_count\s*<\s*v_item\.quantity\s+THEN[\s\S]*?v_fulfillment_data\s*:=\s*jsonb_set\([^;]*?'\{serializedInventoryException\}'[^;]*?'late_payment_reservation_lost'/i;

  assert.match(confirm, paymentLossGuard);
  assert.doesNotMatch(
    confirm.replace('v_reserved_count < v_item.quantity', 'false'),
    paymentLossGuard
  );
});

test('accepts unrelated disjunctions when the stock bound remains conjunctive', () => {
  const matches = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE id = stock_rec.product_id
      AND (active = true OR legacy_active = true)
      AND stock_quantity >= stock_rec.total_quantity;
  `);

  assert.equal(matches.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(matches[0][2]), true);

  const crossedIfBlock = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE stock_quantity >= stock_rec.total_quantity;
    IF NOT FOUND THEN
      NULL;
    END IF;
    IF v_other THEN
      RAISE EXCEPTION 'unrelated';
    END IF;
  `);
  assert.equal(crossedIfBlock.length, 1);
  assert.equal(legacyDecrementHasZeroRowHandling(crossedIfBlock[0]), false);

  const negated = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE NOT (stock_quantity >= stock_rec.total_quantity);
  `);
  assert.equal(negated.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(negated[0][2]), false);

  const postfixNegated = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE (stock_quantity >= stock_rec.total_quantity) IS FALSE;
  `);
  assert.equal(postfixNegated.length, 1);
  assert.equal(
    legacyDecrementHasCompareAndSetGuard(postfixNegated[0][2]),
    false
  );
});

test('rejects locked decrement prechecks hidden in an unreachable branch', () => {
  const [decrement] = legacyDecrementMatches(`
    IF false THEN
      SELECT stock_quantity INTO current_stock FROM products
      WHERE id = stock_rec.product_id FOR UPDATE;
      IF NOT FOUND THEN RETURN; END IF;
      IF current_stock < stock_rec.total_quantity THEN RETURN; END IF;
    END IF;
    UPDATE products SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE id = stock_rec.product_id;
  `);

  assert.equal(legacyDecrementHasCompareAndSetGuard(decrement[2]), false);
  assert.equal(legacyDecrementHasZeroRowHandling(decrement), false);
});

test('resolves function declarations separated by block comments', () => {
  const source = [
    'CREATE FUNCTION private.fixture(integer) RETURNS void AS $$',
    'BEGIN',
    '  NULL;',
    'END;',
    '$$;',
    'CREATE/* replacement */OR REPLACE FUNCTION private.fixture(integer) RETURNS void AS $$',
    'BEGIN',
    "  RAISE EXCEPTION 'replacement';",
    'END;',
    '$$;',
  ].join('\n');

  assert.match(
    latestFunctionBody('private.fixture(integer)', [source]),
    /replacement/
  );
});

test('scans scalar legacy decrement operands', () => {
  const scalar = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = (stock_quantity - p_quantity)
    WHERE id = p_product_id AND stock_quantity >= p_quantity;
    UPDATE product_variants
    SET stock_quantity = stock_quantity - 1
    WHERE id = p_variant_id AND stock_quantity >= 1;
  `);

  assert.equal(scalar.length, 2);
  assert.equal(legacyDecrementHasCompareAndSetGuard(scalar[0][2]), true);
  assert.equal(legacyDecrementHasCompareAndSetGuard(scalar[1][2]), true);
});

test('release lock contracts cover every reserved unit', () => {
  const releaseLock =
    /FROM\s+(?:public\s*\.\s*)?variant_inventory\s+(?:AS\s+)?vi[\s\S]*?WHERE\s+vi\s*\.\s*order_id\s*=\s*p_order_id\s+AND\s+vi\s*\.\s*merchant_id\s*=\s*p_merchant_id\s+AND\s+vi\s*\.\s*status\s*=\s*'reserved'(?:(?!\b(?:LIMIT|OFFSET|FETCH)\b)[\s\S])*?FOR\s+UPDATE(?:\s+OF\s+vi\b)?(?!\s+(?:OF\b|SKIP\s+LOCKED\b))/i;
  assert.doesNotMatch(
    "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' LIMIT 1 FOR UPDATE",
    releaseLock
  );
});

test('binds returned payment exceptions to an actual reservation shortfall', () => {
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  const shortfallException =
    /IF\s*\(\s*v_reserved_count\s*\+\s*v_reclaimed_count\s*\)\s*<\s*v_item\.quantity\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?v_exceptions\s*:=\s*v_exceptions\s*\|\|\s*jsonb_build_object\([^;]*?'code'\s*,\s*'late_payment_reservation_lost'[\s\S]*?RETURN\s+jsonb_build_object\([^;]*?'exceptionCodes'\s*,\s*v_exceptions\b/i;

  assert.match(confirm, shortfallException);
  assert.doesNotMatch(
    [
      'IF (v_reserved_count + v_reclaimed_count) < v_item.quantity THEN',
      '  NULL;',
      'END IF;',
      "IF v_effective_policy = 'serialized_strict' THEN",
      "  v_exceptions := v_exceptions || jsonb_build_object('code', 'late_payment_reservation_lost');",
      'END IF;',
      "RETURN jsonb_build_object('exceptionCodes', v_exceptions);",
    ].join('\n'),
    shortfallException
  );
});
