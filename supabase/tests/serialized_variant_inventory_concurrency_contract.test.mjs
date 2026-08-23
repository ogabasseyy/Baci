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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function functionMarkerPattern(functionName, flags = 'i') {
  const name = functionName.replace(/\($/, '');
  return new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+${escapeRegex(name)}\\s*\\(`,
    flags
  );
}

function functionBody(source, functionName) {
  const markerMatches = [
    ...source.matchAll(functionMarkerPattern(functionName, 'gi')),
  ];
  const start = markerMatches.at(-1)?.index ?? -1;
  assert.notEqual(start, -1, `missing ${functionName}`);

  const opening = /\bAS\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)/i.exec(
    source.slice(start)
  );
  assert.ok(opening, `missing dollar-quote opener for ${functionName}`);

  const bodyStart = start + opening.index + opening[0].length;
  const delimiter = escapeRegex(opening[1]);
  const closing = new RegExp(
    `\\r?\\n[\\t ]*${delimiter}[\\t ]*[^\\r\\n;]*;`,
    'i'
  ).exec(source.slice(bodyStart));
  assert.ok(closing, `unterminated ${functionName}`);
  return source.slice(start, bodyStart + closing.index);
}

function latestFunctionBody(functionName) {
  let latestBody;

  for (const fileName of migrationFileNames()) {
    const source = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
    if (functionMarkerPattern(functionName).test(source)) {
      latestBody = functionBody(source, functionName);
    }
  }

  assert.ok(latestBody, `missing ${functionName} in migrations`);
  return latestBody;
}

function extractIfBranches(source, openingPattern) {
  const lines = source.split(/\r?\n/);
  const openingIndex = lines.findIndex((line) => openingPattern.test(line));
  assert.notEqual(openingIndex, -1, 'missing target IF branch');

  let depth = 1;
  let inElse = false;
  const thenLines = [];
  const elseLines = [];

  for (const line of lines.slice(openingIndex + 1)) {
    if (/^\s*IF\b/i.test(line)) {
      depth += 1;
    } else if (/^\s*END\s+IF\b/i.test(line)) {
      depth -= 1;
      if (depth === 0) {
        assert.ok(inElse, 'target IF branch is missing ELSE');
        return {
          thenBranch: thenLines.join('\n'),
          elseBranch: elseLines.join('\n'),
        };
      }
    } else if (depth === 1 && /^\s*ELSE\b/i.test(line)) {
      inElse = true;
      continue;
    }

    (inElse ? elseLines : thenLines).push(line);
  }

  assert.fail('unterminated target IF branch');
}

function legacyDecrementMatches(source) {
  return [
    ...source.matchAll(
      /UPDATE\s+(?:ONLY\s+)?(?:public\s*\.\s*)?(product_variants|products)(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET\s+stock_quantity\s*=\s*(?:(?:[a-z_][a-z0-9_]*)\s*\.\s*)?stock_quantity\s*-\s*stock_rec\s*\.\s*total_quantity([\s\S]*?);/gi
    ),
  ];
}

test('function extraction tolerates tagged dollar quotes and trailing clauses', () => {
  const source = [
    'CREATE OR REPLACE FUNCTION private.fixture(',
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
    /FROM\s+(?:public\s*\.\s*)?order_items(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?[\s\S]*?WHERE\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?id\s*=\s*p_order_item_id[\s\S]*?FOR\s+UPDATE/i;
  const availableUnitLock =
    /vi\s*\.\s*status\s*=\s*'available'[\s\S]*?vi\s*\.\s*order_id\s+IS\s+NULL[\s\S]*?vi\s*\.\s*order_item_id\s+IS\s+NULL[\s\S]*?vi\s*\.\s*sold_at\s+IS\s+NULL[\s\S]*?FOR\s+UPDATE\s+SKIP\s+LOCKED/i;

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
    /v_effective_policy\s*=\s*'serialized_strict'[\s\S]*?serialized_inventory_unavailable/i,
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
    /UPDATE\s+(?:ONLY\s+)?(?:public\s*\.\s*)?(?:products|product_variants)(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET[\s\S]*?stock_quantity\s*=\s*(?:(?:[a-z_][a-z0-9_]*)\s*\.\s*)?stock_quantity\s*-\s*/i,
    'serialized claims must not also decrement legacy product stock'
  );

  const confirmOrderLock =
    /FROM\s+(?:public\s*\.\s*)?orders(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?[^;]*?WHERE\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?id\s*=\s*p_order_id\s+AND\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?merchant_id\s*=\s*p_merchant_id[^;]*?FOR\s+UPDATE/i;
  const orderItemsQuery =
    /FROM\s+(?:public\s*\.\s*)?order_items(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?/i;
  assert.match(
    confirm,
    confirmOrderLock,
    'payment confirmation must re-lock the parent order'
  );
  assert.match(
    confirm,
    /v_effective_policy\s*=\s*'serialized_strict'[\s\S]*?late_payment_reservation_lost/i,
    'strict payment confirmation must expose a reservation-loss exception'
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
        /stock_quantity\s*>=\s*stock_rec\s*\.\s*total_quantity/i,
        `${migration} must compare-and-set guard each ${table} legacy decrement`
      );
    }
  }
});
