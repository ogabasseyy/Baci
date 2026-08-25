import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { extractIfBranches, latestFunctionBody } = serializedInventoryContract;
const { isRequiredConjunct } = serializedInventorySqlParser;
const orderLock =
  /FROM\s+(?:public\s*\.\s*)?orders(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?[^;]*?WHERE\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?id\s*=\s*p_order_id\s+AND\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?merchant_id\s*=\s*p_merchant_id[^;]*?FOR\s+UPDATE(?!\s+(?:SKIP\s+LOCKED|NOWAIT|OF\s+[a-z_][a-z0-9_]*\s+(?:SKIP\s+LOCKED|NOWAIT))\b)(?:\s+OF\s+[a-z_][a-z0-9_]*)?/i;

function releaseLockMatches(source) {
  const query =
    /FROM\s+(?:public\s*\.\s*)?variant_inventory\s+(?:AS\s+)?vi[\s\S]*?WHERE\s+([\s\S]*?)FOR\s+UPDATE(?:\s+OF\s+vi\b)?(?!\s+(?:OF\b|SKIP\s+LOCKED\b|NOWAIT\b))/i.exec(
      source
    );
  if (!query || /\b(?:LIMIT|OFFSET|FETCH)\b/i.test(query[1])) return false;
  return [
    /vi\s*\.\s*order_id\s*=\s*p_order_id\b/i,
    /vi\s*\.\s*merchant_id\s*=\s*p_merchant_id\b/i,
    /vi\s*\.\s*status\s*=\s*'reserved'/i,
  ].every((predicate) => isRequiredConjunct(query[1], predicate));
}

function releaseTransition(branch, targetStatus) {
  const update =
    /UPDATE\s+(?:public\s*\.\s*)?variant_inventory\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*?);/i.exec(
      branch
    );
  if (
    !update ||
    !new RegExp(`\\bstatus\\s*=\\s*'${targetStatus}'`, 'i').test(update[1])
  ) {
    return false;
  }
  const clearsOwnership =
    targetStatus !== 'available' ||
    [
      'order_id',
      'order_item_id',
      'reserved_at',
      'reservation_expires_at',
    ].every((column) =>
      new RegExp(`\\b${column}\\s*=\\s*NULL\\b`, 'i').test(update[1])
    );
  return (
    clearsOwnership &&
    isRequiredConjunct(
      update[2],
      /(?:[a-z_][a-z0-9_]*\s*\.\s*)?id\s*=\s*v_unit\s*\.\s*id\b/i
    )
  );
}

test('release serializes on its order before locking reserved inventory', () => {
  const release = latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  const publicRelease = latestFunctionBody(
    'public.release_order_inventory_units(uuid, uuid, text)'
  );
  const branches = extractIfBranches(
    release,
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );

  assert.match(release, orderLock, 'release must lock its parent order');
  assert.match(
    release,
    new RegExp(
      `${orderLock.source}\\s*;\\s*IF\\s+NOT\\s+FOUND\\s+THEN\\s+RAISE\\s+EXCEPTION\\s+['"]order_not_found['"]`,
      'i'
    ),
    'release must fail closed when its scoped parent order does not exist'
  );
  assert.ok(
    release.search(orderLock) <
      release.indexOf("IF v_target_status = 'available'"),
    'release must lock its parent order before inventory reconciliation'
  );
  assert.equal(releaseLockMatches(branches.thenBranch), true);
  assert.equal(releaseLockMatches(branches.elseBranch), true);
  assert.equal(releaseTransition(branches.thenBranch, 'available'), true);
  assert.equal(releaseTransition(branches.elseBranch, 'returned'), true);
  assert.match(
    publicRelease,
    /RETURN\s+private\s*\.\s*release_order_inventory_units\s*\(\s*p_merchant_id\s*,\s*p_order_id\s*,\s*p_target_status\s*\)\s*;/i,
    'public release must delegate all validated parameters unchanged'
  );
  assert.equal(
    releaseTransition(
      branches.thenBranch.replace("status = 'available',", ''),
      'available'
    ),
    false
  );
  assert.equal(
    releaseTransition(
      branches.thenBranch.replace(
        'WHERE id = v_unit.id;',
        'WHERE id = v_unit.id OR merchant_id = p_merchant_id;'
      ),
      'available'
    ),
    false
  );
});

test('release inventory locks remain blocking and target their selected rows', () => {
  assert.equal(
    releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' FOR UPDATE OF pv"
    ),
    false
  );
  assert.equal(
    releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' FOR UPDATE SKIP LOCKED"
    ),
    false
  );
  assert.equal(
    releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' FOR UPDATE OF vi NOWAIT"
    ),
    false
  );
  assert.equal(
    releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' OR true FOR UPDATE"
    ),
    false
  );
  assert.doesNotMatch(
    'FROM orders o WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id FOR UPDATE OF o SKIP LOCKED',
    orderLock
  );
  assert.doesNotMatch(
    'FROM orders o WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id FOR UPDATE OF o NOWAIT',
    orderLock
  );
});
