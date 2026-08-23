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
  legacyDecrementHasCompareAndSetGuard,
} = serializedInventoryContract;

test('function extraction tolerates tagged dollar quotes and trailing clauses', () => {
  const source = [
    'CREATE FUNCTION private.fixture(',
    '  p_value integer',
    ') RETURNS void',
    'LANGUAGE plpgsql',
    'AS $fixture$',
    'BEGIN',
    '  NULL;',
    'END;',
    '$fixture$ LANGUAGE plpgsql;',
  ].join('\r\n');

  assert.match(
    functionBody(source, 'private.fixture('),
    /\r\nBEGIN\r\n\s+NULL;/
  );
  assert.throws(
    () =>
      latestFunctionBody('private.fixture(', [
        source,
        'DROP FUNCTION private.fixture;',
      ]),
    /missing private\.fixture/
  );
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
    'private.claim_variant_inventory_units_for_order_item_internal('
  );

  const orderLock =
    /FROM\s+(?:public\s*\.\s*)?orders(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+WHERE\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?id\s*=\s*p_order_id\s+AND\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?merchant_id\s*=\s*p_merchant_id\s+FOR\s+UPDATE/i;
  const itemLock =
    /FROM\s+(?:public\s*\.\s*)?order_items(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?[^;]*?WHERE\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?id\s*=\s*p_order_item_id[^;]*?FOR\s+UPDATE/i;
  const availableUnitLock =
    /vi\s*\.\s*merchant_id\s*=\s*p_merchant_id[^;]*?vi\s*\.\s*variant_id\s*=\s*v_variant_id[^;]*?vi\s*\.\s*status\s*=\s*'available'[^;]*?vi\s*\.\s*order_id\s+IS\s+NULL[^;]*?vi\s*\.\s*order_item_id\s+IS\s+NULL[^;]*?vi\s*\.\s*sold_at\s+IS\s+NULL[^;]*?LIMIT\s+v_needed\s+FOR\s+UPDATE\s+SKIP\s+LOCKED/i;

  assert.match(
    claim,
    orderLock,
    'same-order claims must serialize on the parent order row'
  );
  assert.match(
    claim,
    itemLock,
    'same-item retries must serialize on the order item row'
  );
  assert.match(
    claim,
    availableUnitLock,
    'claims must lock only still-available, unlinked units'
  );
  assert.ok(
    claim.search(orderLock) < claim.search(itemLock),
    'claims must take the parent-order lock before the order-item lock'
  );
  assert.match(
    claim,
    /IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+AND[^;]*?THEN[^;]*?RAISE\s+EXCEPTION\s+['"]serialized_inventory_unavailable['"]/i,
    'strict serialized inventory must fail closed when another order claims the last unit'
  );
});

test('serialized policy boundaries preserve fallback counts and payment-loss reporting', () => {
  const claim = latestFunctionBody(
    'private.claim_variant_inventory_units_for_order_item_internal('
  );
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations('
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
  const confirmAvailableUnitLock =
    /vi\s*\.\s*merchant_id\s*=\s*p_merchant_id[^;]*?vi\s*\.\s*variant_id\s*=\s*v_actual_variant_id[^;]*?vi\s*\.\s*status\s*=\s*'available'[^;]*?vi\s*\.\s*order_id\s+IS\s+NULL[^;]*?vi\s*\.\s*order_item_id\s+IS\s+NULL[^;]*?vi\s*\.\s*sold_at\s+IS\s+NULL[^;]*?LIMIT\s+v_needed\s+FOR\s+UPDATE\s+SKIP\s+LOCKED/i;
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
  assert.match(
    confirm,
    confirmAvailableUnitLock,
    'payment confirmation reclaim must lock scoped available units'
  );
  assert.ok(
    confirm.search(confirmOrderLock) < confirmOrderItemsIndex,
    'payment confirmation must take the parent-order lock before item locks'
  );
});

test('release locks only reserved units owned by the target merchant and order', () => {
  const release = latestFunctionBody('private.release_order_inventory_units(');
  const releaseLock =
    /FROM\s+(?:public\s*\.\s*)?variant_inventory\s+(?:AS\s+)?vi[\s\S]*?WHERE\s+vi\s*\.\s*order_id\s*=\s*p_order_id\s+AND\s+vi\s*\.\s*merchant_id\s*=\s*p_merchant_id\s+AND\s+vi\s*\.\s*status\s*=\s*'reserved'[\s\S]*?FOR\s+UPDATE/i;
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
    UPDATE product_variants AS p
    SET stock_quantity = GREATEST(p.stock_quantity - stock_rec.total_quantity, 0)
    WHERE p.id = stock_rec.variant_id AND stock_quantity >= stock_rec.total_quantity;
  `);
  assert.equal(wrapped.length, 2);

  const nestedWhere = `
    UPDATE products
    SET stock_quantity = stock_quantity - stock_rec.total_quantity
    WHERE id IN (SELECT id FROM products WHERE stock_quantity >= stock_rec.total_quantity)
      AND stock_quantity >= stock_rec.total_quantity;
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

    for (const [, table, statement] of decrements) {
      assert.ok(
        legacyDecrementHasCompareAndSetGuard(statement),
        `${migration} must compare-and-set guard each ${table} legacy decrement`
      );
    }
  }
});
