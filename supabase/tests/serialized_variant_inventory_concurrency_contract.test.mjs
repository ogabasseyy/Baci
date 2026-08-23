import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';

const {
  migrationsDir,
  migrationFileNames,
  functionBody,
  latestFunctionBody,
  extractIfBranches,
  legacyDecrementMatches,
  legacyDecrementHasZeroRowHandling,
  legacyDecrementHasCompareAndSetGuard,
  availableUnitPredicatesMatch,
  findClaimLocks,
} = serializedInventoryContract;

test('function extraction tolerates tagged dollar quotes and trailing clauses', () => {
  const source = [
    'CREATE FUNCTION private.fixture(',
    '  p_value integer',
    ') RETURNS void',
    'LANGUAGE plpgsql',
    'AS $fixture$',
    'BEGIN',
    "  RAISE NOTICE 'https://example.test/a--b/*literal*/;';",
    'END;',
    '$fixture$ LANGUAGE plpgsql;',
  ].join('\r\n');

  assert.match(
    functionBody(source, 'private.fixture(integer)'),
    /\r\nBEGIN\r\n\s+RAISE NOTICE 'https:\/\/example\.test\/a--b\/\*literal\*\/;'/
  );
  assert.throws(
    () =>
      latestFunctionBody('private.fixture(integer)', [
        source,
        'DROP FUNCTION private.fixture;',
      ]),
    /missing private\.fixture/
  );
});

test('function extraction resolves overloads by expected input types', () => {
  const source = [
    'CREATE FUNCTION private.fixture(p_value integer) RETURNS void AS $$',
    'BEGIN',
    '  NULL;',
    'END;',
    '$$;',
    'CREATE FUNCTION private.fixture(p_value text) RETURNS void AS $$',
    'BEGIN',
    "  RAISE NOTICE 'text';",
    'END;',
    '$$;',
  ].join('\n');

  const body = latestFunctionBody('private.fixture(integer)', [source]);
  assert.match(body, /p_value integer/);
  assert.doesNotMatch(body, /p_value text/);
});

test('branch extraction handles nested IF blocks without fixed indentation', () => {
  const branches = extractIfBranches(
    [
      "IF v_target_status = 'available' THEN",
      '    IF v_nested THEN',
      '      PERFORM 1;',
      '    END IF;',
      '  ELSE',
      'IF v_other_nested THEN',
      '  PERFORM 2;',
      'END IF;',
      'END IF;',
    ].join('\n'),
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );

  assert.match(branches.thenBranch, /v_nested/);
  assert.match(branches.elseBranch, /v_other_nested/);
});

function migrationFilesWithLegacyDecrements() {
  return migrationFileNames().filter((fileName) => {
    const source = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
    return legacyDecrementMatches(source).length > 0;
  });
}

test('serialized claims lock the order before the item and skip locked available units', () => {
  const claim = latestFunctionBody(
    'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)'
  );

  const claimLocks = findClaimLocks(claim);
  assert.ok(
    claimLocks.order,
    'same-order claims must serialize on the parent order row'
  );
  assert.ok(
    claimLocks.item,
    'same-item retries must serialize on the order item row'
  );
  assert.ok(
    availableUnitPredicatesMatch(claim, 'v_variant_id'),
    'claims must enforce each scoped availability predicate'
  );
  assert.ok(
    claimLocks.order.index < claimLocks.item.index,
    'claims must take the parent-order lock before the order-item lock'
  );
  const strictShortage =
    /IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+AND\s+(?:\(\s*)?v_reserved_count\s*\+\s*v_claimed_count\s*(?:\s*\))?\s*<\s*v_qty\s+THEN[\s\S]*?RAISE\s+EXCEPTION\s+['"]serialized_inventory_unavailable['"]/i;
  assert.match(
    claim,
    strictShortage,
    'strict serialized inventory must fail closed when another order claims the last unit'
  );
  assert.doesNotMatch(
    "IF v_effective_policy = 'serialized_strict' AND false THEN RAISE EXCEPTION 'serialized_inventory_unavailable'; END IF;",
    strictShortage
  );
});

test('serialized policy boundaries preserve fallback counts and payment-loss reporting', () => {
  const claim = latestFunctionBody(
    'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)'
  );
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );

  assert.match(
    claim,
    /v_fulfillment_data\s*:=\s*jsonb_build_object\([\s\S]*?'missingUnitCount',\s*GREATEST\(v_qty\s*-\s*v_reserved_count,\s*0\)/,
    'serialized_then_unlimited must report missing units instead of fabricating reservations'
  );
  assert.equal(
    legacyDecrementMatches(claim).length,
    0,
    'serialized claims must not also decrement legacy product stock'
  );

  const confirmOrderLock =
    /FROM\s+(?:public\s*\.\s*)?orders(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?[^;]*?WHERE\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?id\s*=\s*p_order_id\s+AND\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?merchant_id\s*=\s*p_merchant_id[^;]*?FOR\s+UPDATE/i;
  const orderItemsQuery =
    /FROM\s+(?:public\s*\.\s*)?order_items(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?[^;]*?WHERE\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?order_id\s*=\s*p_order_id[^;]*?FOR\s+UPDATE/i;
  assert.ok(
    availableUnitPredicatesMatch(confirm, 'v_actual_variant_id'),
    'payment confirmation must enforce each scoped availability predicate'
  );
  assert.match(
    confirm,
    confirmOrderLock,
    'payment confirmation must re-lock the parent order'
  );
  assert.match(
    confirm,
    /IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+AND[^;]*?THEN[^;]*?v_fulfillment_data\s*:=\s*jsonb_set\([^;]*?'\{serializedInventoryException\}'[^;]*?'late_payment_reservation_lost'/i,
    'strict payment confirmation must write the reservation-loss exception into fulfillment data'
  );
  assert.match(
    confirm,
    /IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+THEN[^;]*?v_exceptions\s*:=\s*v_exceptions\s*\|\|\s*jsonb_build_object\([^;]*?'code'\s*,\s*'late_payment_reservation_lost'[\s\S]*?RETURN\s+jsonb_build_object\([^;]*?'exceptionCodes'\s*,\s*v_exceptions\b/i,
    'strict payment confirmation must append and return reservation-loss exception codes'
  );
  const confirmOrderItemsIndex = confirm.search(orderItemsQuery);
  assert.ok(
    confirmOrderItemsIndex >= 0,
    'payment confirmation must reconcile order items'
  );
  assert.ok(
    confirm.search(confirmOrderLock) < confirmOrderItemsIndex,
    'payment confirmation must take the parent-order lock before item locks'
  );
});

test('release locks only reserved units owned by the target merchant and order', () => {
  const release = latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  const releaseLock =
    /FROM\s+(?:public\s*\.\s*)?variant_inventory\s+(?:AS\s+)?vi[\s\S]*?WHERE\s+vi\s*\.\s*order_id\s*=\s*p_order_id\s+AND\s+vi\s*\.\s*merchant_id\s*=\s*p_merchant_id\s+AND\s+vi\s*\.\s*status\s*=\s*'reserved'[\s\S]*?FOR\s+UPDATE(?:\s+OF\s+vi\b)?(?!\s+OF\b)/i;
  const branches = extractIfBranches(
    release,
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );

  assert.match(
    branches.thenBranch,
    releaseLock,
    'available release must lock only reserved units belonging to the target merchant and order'
  );
  assert.match(
    branches.elseBranch,
    releaseLock,
    'returned release must lock only reserved units belonging to the target merchant and order'
  );
  assert.doesNotMatch(
    "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' FOR UPDATE OF pv",
    releaseLock
  );
});

test('legacy decrement scanning recognizes qualified aliases and flexible SQL formatting', () => {
  const matches = legacyDecrementMatches(`
    -- UPDATE public.products SET stock_quantity = stock_quantity - stock_rec.total_quantity;
    UPDATE public.products AS p
    SET updated_at = now(),
        stock_quantity = p.stock_quantity
      - stock_rec . total_quantity
    WHERE p.stock_quantity >= stock_rec.total_quantity;
  `);

  assert.equal(matches.length, 1);
  assert.match(
    matches[0][2],
    /stock_quantity\s*>=\s*stock_rec\.total_quantity/
  );
  const unguarded = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE products.id = stock_rec.product_id
       OR stock_quantity >= stock_rec.total_quantity;
  `);
  assert.equal(unguarded.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(unguarded[0][2]), false);

  const wrapped = legacyDecrementMatches(`
    UPDATE products
    SET stock_quantity = (stock_quantity - stock_rec.total_quantity)
    WHERE products.id = stock_rec.product_id AND stock_quantity >= stock_rec.total_quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient_stock';
    END IF;
    UPDATE product_variants AS p
    SET note = 'semi;--literal/*text*/',
        stock_quantity = GREATEST(p.stock_quantity - stock_rec.total_quantity, 0)
    WHERE p.id = stock_rec.variant_id AND stock_quantity >= stock_rec.total_quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient_variant_stock';
    END IF;
  `);
  assert.equal(wrapped.length, 2);
  assert.equal(legacyDecrementHasZeroRowHandling(wrapped[0]), true);
  assert.equal(legacyDecrementHasZeroRowHandling(wrapped[1]), true);
  assert.equal(legacyDecrementHasZeroRowHandling(unguarded[0]), false);

  const equivalent = legacyDecrementMatches(
    'UPDATE products SET stock_quantity = stock_quantity - inventory_rec.total_quantity WHERE (inventory_rec.total_quantity <= (stock_quantity));'
  );
  assert.equal(equivalent.length, 1);
  assert.equal(legacyDecrementHasCompareAndSetGuard(equivalent[0][2]), true);

  const nestedWhere = `
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE id IN (SELECT id FROM products WHERE stock_quantity >= stock_rec.total_quantity)
      AND (stock_quantity >= stock_rec.total_quantity);
  `;
  assert.equal(legacyDecrementHasCompareAndSetGuard(nestedWhere), true);
  const subqueryOnly = `
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE id IN (SELECT id FROM products WHERE stock_quantity >= stock_rec.total_quantity)
      AND active = true;
  `;
  assert.equal(legacyDecrementHasCompareAndSetGuard(subqueryOnly), false);
});
test('every legacy stock decrement remains compare-and-set guarded', () => {
  const migrationFiles = migrationFilesWithLegacyDecrements();
  assert.ok(
    migrationFiles.length > 0,
    'expected at least one legacy stock decrement migration'
  );

  for (const migration of migrationFiles) {
    const source = fs.readFileSync(path.join(migrationsDir, migration), 'utf8');
    const decrements = legacyDecrementMatches(source);

    for (const decrement of decrements) {
      const [, table, statement] = decrement;
      assert.ok(
        legacyDecrementHasCompareAndSetGuard(statement),
        `${migration} must compare-and-set guard each ${table} legacy decrement`
      );
      assert.ok(
        legacyDecrementHasZeroRowHandling(decrement),
        `${migration} must fail closed when each ${table} legacy decrement affects zero rows`
      );
    }
  }
});
