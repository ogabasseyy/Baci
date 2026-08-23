import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

function migrationFileNames() {
  return fs
    .readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
}

function functionBody(source, functionName) {
  const marker = `CREATE OR REPLACE FUNCTION ${functionName}`;
  const start = source.lastIndexOf(marker);
  assert.notEqual(start, -1, `missing ${functionName}`);

  const end = source.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `unterminated ${functionName}`);
  return source.slice(start, end);
}

function latestFunctionBody(functionName) {
  let latestBody;

  for (const fileName of migrationFileNames()) {
    const source = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
    if (source.includes(`CREATE OR REPLACE FUNCTION ${functionName}`)) {
      latestBody = functionBody(source, functionName);
    }
  }

  assert.ok(latestBody, `missing ${functionName} in migrations`);
  return latestBody;
}

function legacyDecrementMatches(source) {
  return [
    ...source.matchAll(
      /UPDATE\s+(?:ONLY\s+)?(?:public\s*\.\s*)?(product_variants|products)(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET\s+stock_quantity\s*=\s*(?:(?:[a-z_][a-z0-9_]*)\s*\.\s*)?stock_quantity\s*-\s*stock_rec\s*\.\s*total_quantity([\s\S]*?);/gi
    ),
  ];
}

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
    /FROM public\.orders WHERE id = p_order_id AND merchant_id = p_merchant_id FOR UPDATE/;
  const itemLock =
    /FROM public\.order_items oi[\s\S]*WHERE oi\.id = p_order_item_id[\s\S]*FOR UPDATE/;
  const availableUnitLock =
    /vi\.status = 'available'[\s\S]*vi\.order_id IS NULL[\s\S]*vi\.order_item_id IS NULL[\s\S]*vi\.sold_at IS NULL[\s\S]*FOR UPDATE SKIP LOCKED/;

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
    /v_effective_policy = 'serialized_strict'[\s\S]*serialized_inventory_unavailable/,
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
  assert.doesNotMatch(
    claim,
    /UPDATE (?:public\.)?(?:products|product_variants)(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET[\s\S]*stock_quantity = stock_quantity -/i,
    'serialized claims must not also decrement legacy product stock'
  );

  const confirmOrderLock =
    /FROM public\.orders[^;]*?WHERE id = p_order_id AND merchant_id = p_merchant_id[^;]*?FOR UPDATE/;
  assert.match(
    confirm,
    confirmOrderLock,
    'payment confirmation must re-lock the parent order'
  );
  assert.match(
    confirm,
    /v_effective_policy = 'serialized_strict'[\s\S]*late_payment_reservation_lost/,
    'strict payment confirmation must expose a reservation-loss exception'
  );
  assert.ok(
    confirm.search(confirmOrderLock) <
      confirm.indexOf('FROM public.order_items oi'),
    'payment confirmation must take the parent-order lock before item locks'
  );
});

test('release locks only reserved units owned by the target merchant and order', () => {
  const release = latestFunctionBody('private.release_order_inventory_units(');
  const releaseLock =
    /FROM public\.variant_inventory vi[\s\S]*?WHERE vi\.order_id = p_order_id AND vi\.merchant_id = p_merchant_id AND vi\.status = 'reserved'[\s\S]*?FOR UPDATE/;
  const availableBranch = release.match(
    /IF v_target_status = 'available' THEN([\s\S]*?)\n\s{2}ELSE/
  );
  const returnedBranch = release.match(/\n\s{2}ELSE([\s\S]*?)\n\s{2}END IF;/);

  assert.ok(availableBranch, 'release must retain its available branch');
  assert.ok(returnedBranch, 'release must retain its returned branch');

  assert.match(
    availableBranch[1],
    releaseLock,
    'available release must lock only reserved units belonging to the target merchant and order'
  );
  assert.match(
    returnedBranch[1],
    releaseLock,
    'returned release must lock only reserved units belonging to the target merchant and order'
  );
});

test('legacy decrement scanning recognizes qualified aliases and flexible SQL formatting', () => {
  const matches = legacyDecrementMatches(`
    UPDATE public.products AS p
    SET stock_quantity = p.stock_quantity
      - stock_rec . total_quantity
    WHERE p.stock_quantity >= stock_rec.total_quantity;
  `);

  assert.equal(matches.length, 1);
  assert.match(
    matches[0][2],
    /stock_quantity\s*>=\s*stock_rec\.total_quantity/
  );
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
      assert.match(
        statement,
        /stock_quantity >= stock_rec\.total_quantity/,
        `${migration} must compare-and-set guard each ${table} legacy decrement`
      );
    }
  }
});
