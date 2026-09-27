import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryReleaseLocks } from './serialized_variant_inventory_concurrency_contract_release_locks.mjs';

test('release authorization requires a null-safe auth role guard', () => {
  const nullSafeGuard = `IF COALESCE((SELECT auth.role()), '') <> 'service_role'
    AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_target_status = 'available' THEN
    PERFORM 1;
  END IF;`;
  const rawGuard = nullSafeGuard.replace(
    /COALESCE\(\(SELECT auth\.role\(\)\), ''\)/,
    'auth.role()'
  );
  assert.equal(
    serializedInventoryReleaseLocks.hasMerchantAuthorizationGuard(
      nullSafeGuard
    ),
    true
  );
  assert.equal(
    serializedInventoryReleaseLocks.hasMerchantAuthorizationGuard(rawGuard),
    false
  );
});

test('release authorization rejects a raw-auth-role mutation', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  assert.equal(
    serializedInventoryReleaseLocks.hasMerchantAuthorizationGuard(release),
    true
  );
  const rawRoleRelease = release.replace(
    /COALESCE\(\s*\(\s*SELECT\s+auth\.role\(\s*\)\s*\)\s*,\s*''\s*\)/i,
    'auth.role()'
  );
  assert.equal(
    serializedInventoryReleaseLocks.hasMerchantAuthorizationGuard(
      rawRoleRelease
    ),
    false
  );
});

test('release authorization rejects an unreachable forbidden exception', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  const unreachable = release.replace(
    /RAISE\s+EXCEPTION\s+['"]forbidden['"][^;]*;/i,
    (raise) => `IF false THEN\n${raise}\nEND IF;`
  );

  assert.equal(
    serializedInventoryReleaseLocks.hasMerchantAuthorizationGuard(unreachable),
    false
  );
});

test('rejects release selectors narrowed on joined product rows', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(release),
    true
  );
  const narrowed = release.replace(
    "AND vi.status = 'reserved'",
    "AND vi.status = 'reserved' AND pv.product_id IS NULL"
  );
  assert.notEqual(narrowed, release);
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(narrowed),
    false
  );
});

test('rejects unsatisfiable reserved-unit release selectors', () => {
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' AND false FOR UPDATE"
    ),
    false
  );
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' AND vi.status <> 'reserved' FOR UPDATE"
    ),
    false
  );
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.order_id IS NULL AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' FOR UPDATE"
    ),
    false
  );
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'available' FOR UPDATE"
    ),
    false
  );
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.order_id <> p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' FOR UPDATE"
    ),
    false
  );
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.merchant_id <> p_merchant_id AND vi.status = 'reserved' FOR UPDATE"
    ),
    false
  );
});

test('requires release selectors to lock inventory rows only', () => {
  const selector =
    "FROM variant_inventory vi JOIN product_variants pv ON vi.variant_id = pv.id WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved'";

  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      `${selector} FOR UPDATE`
    ),
    false
  );
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      `${selector} ORDER BY pv.product_id, vi.id FOR UPDATE OF vi`
    ),
    true
  );
});

test('requires deterministic product and unit ordering for both release selectors', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  const branches = serializedInventoryContract.extractIfBranches(
    release,
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );
  const ordering =
    /ORDER\s+BY\s+pv\s*\.\s*product_id\s*,\s*vi\s*\.\s*id\s+FOR\s+UPDATE\s+OF\s+vi\b/i;
  assert.match(branches.thenBranch, ordering);
  assert.match(branches.elseBranch, ordering);
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      branches.thenBranch.replace(ordering, 'FOR UPDATE OF vi')
    ),
    false
  );
  assert.equal(
    serializedInventoryReleaseLocks.releaseLockMatches(
      branches.elseBranch.replace(ordering, 'FOR UPDATE OF vi')
    ),
    false
  );
});

test('rejects unit-narrowing release selectors in both branches', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  const branches = serializedInventoryContract.extractIfBranches(
    release,
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );
  for (const branch of [branches.thenBranch, branches.elseBranch]) {
    assert.equal(
      serializedInventoryReleaseLocks.releaseLockMatches(branch),
      true
    );
    assert.equal(
      serializedInventoryReleaseLocks.releaseLockMatches(
        branch.replace(
          /AND\s+vi\s*\.\s*status\s*=\s*'reserved'/i,
          "AND vi.status = 'reserved' AND vi.id = p_only_unit"
        )
      ),
      false
    );
  }
});

test('rejects function-narrowed release selectors in both branches', () => {
  const release = serializedInventoryContract.latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  const branches = serializedInventoryContract.extractIfBranches(
    release,
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );
  for (const branch of [branches.thenBranch, branches.elseBranch]) {
    assert.equal(
      serializedInventoryReleaseLocks.releaseLockMatches(branch),
      true
    );
    const narrowed = branch.replace(
      /AND\s+vi\s*\.\s*status\s*=\s*'reserved'/i,
      (status) => `${status} AND pg_catalog.length('') > 0`
    );
    assert.notEqual(narrowed, branch);
    assert.equal(
      serializedInventoryReleaseLocks.releaseLockMatches(narrowed),
      false
    );
  }
});
