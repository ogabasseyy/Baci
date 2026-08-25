import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';

const { extractIfBranches, latestFunctionBody } = serializedInventoryContract;
const orderLock =
  /FROM\s+(?:public\s*\.\s*)?orders(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?[^;]*?WHERE\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?id\s*=\s*p_order_id\s+AND\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?merchant_id\s*=\s*p_merchant_id[^;]*?FOR\s+UPDATE(?!\s+(?:SKIP\s+LOCKED|NOWAIT)\b)/i;
const releaseLock =
  /FROM\s+(?:public\s*\.\s*)?variant_inventory\s+(?:AS\s+)?vi[\s\S]*?WHERE\s+vi\s*\.\s*order_id\s*=\s*p_order_id\s+AND\s+vi\s*\.\s*merchant_id\s*=\s*p_merchant_id\s+AND\s+vi\s*\.\s*status\s*=\s*'reserved'(?:(?!\b(?:LIMIT|OFFSET|FETCH)\b)[\s\S])*?FOR\s+UPDATE(?:\s+OF\s+vi\b)?(?!\s+(?:OF\b|SKIP\s+LOCKED\b|NOWAIT\b))/i;

test('release serializes on its order before locking reserved inventory', () => {
  const release = latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  const branches = extractIfBranches(
    release,
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );

  assert.match(release, orderLock, 'release must lock its parent order');
  assert.ok(
    release.search(orderLock) <
      release.indexOf("IF v_target_status = 'available'"),
    'release must lock its parent order before inventory reconciliation'
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

test('release inventory locks remain blocking and target their selected rows', () => {
  assert.doesNotMatch(
    "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' FOR UPDATE OF pv",
    releaseLock
  );
  assert.doesNotMatch(
    "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' FOR UPDATE SKIP LOCKED",
    releaseLock
  );
  assert.doesNotMatch(
    "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' FOR UPDATE OF vi NOWAIT",
    releaseLock
  );
});
