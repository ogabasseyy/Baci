import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const serializedMigration = fs.readFileSync(
  path.join(migrationsDir, '20260615181534_serialized_variant_inventory.sql'),
  'utf8'
);

function functionBody(source, functionName) {
  const marker = `CREATE OR REPLACE FUNCTION ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${functionName}`);

  const end = source.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `unterminated ${functionName}`);
  return source.slice(start, end);
}

function migrationFilesWithLegacyDecrements() {
  return fs
    .readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .filter((fileName) => {
      const source = fs.readFileSync(
        path.join(migrationsDir, fileName),
        'utf8'
      );
      return source.includes(
        'stock_quantity = stock_quantity - stock_rec.total_quantity'
      );
    });
}

test('serialized claims lock the order before the item and skip locked available units', () => {
  const claim = functionBody(
    serializedMigration,
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
  const claim = functionBody(
    serializedMigration,
    'private.claim_variant_inventory_units_for_order_item_internal('
  );
  const confirm = functionBody(
    serializedMigration,
    'private.confirm_order_inventory_reservations('
  );

  assert.match(
    claim,
    /v_effective_policy = 'serialized_then_unlimited'[\s\S]*v_missing_count/,
    'serialized_then_unlimited must report missing units instead of fabricating reservations'
  );
  assert.doesNotMatch(
    claim,
    /UPDATE (?:public\.)?(?:products|product_variants)(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET[\s\S]*stock_quantity = stock_quantity -/i,
    'serialized claims must not also decrement legacy product stock'
  );

  const confirmOrderLock =
    /FROM public\.orders[\s\S]*WHERE id = p_order_id AND merchant_id = p_merchant_id[\s\S]*FOR UPDATE/;
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
  const release = functionBody(
    serializedMigration,
    'private.release_order_inventory_units('
  );

  assert.match(
    release,
    /vi\.order_id = p_order_id AND vi\.merchant_id = p_merchant_id AND vi\.status = 'reserved'[\s\S]*FOR UPDATE/,
    'release must lock only reserved units belonging to the target merchant and order'
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
    const decrements = source.matchAll(
      /UPDATE (?:public\.)?(product_variants|products)(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET stock_quantity = stock_quantity - stock_rec\.total_quantity([\s\S]*?);/gi
    );

    for (const [, table, statement] of decrements) {
      assert.match(
        statement,
        /stock_quantity >= stock_rec\.total_quantity/,
        `${migration} must compare-and-set guard each ${table} legacy decrement`
      );
    }
  }
});
