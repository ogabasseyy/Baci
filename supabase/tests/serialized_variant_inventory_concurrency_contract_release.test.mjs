import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryConfirmation } from './serialized_variant_inventory_concurrency_contract_confirmation.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventoryReleaseLocks } from './serialized_variant_inventory_concurrency_contract_release_locks.mjs';
import { serializedInventoryReleaseTransitions } from './serialized_variant_inventory_concurrency_contract_release_transitions.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { extractIfBranches, latestFunctionBody } = serializedInventoryContract;
const { hasTargetStatusWhitelist, releaseLockMatches } =
  serializedInventoryReleaseLocks;
const { releaseBranchesMatch, releaseTransition } =
  serializedInventoryReleaseTransitions;

test('release serializes on its order before locking reserved inventory', () => {
  const release = latestFunctionBody(
    'private.release_order_inventory_units(uuid, uuid, text)'
  );
  const publicRelease = latestFunctionBody(
    'public.release_order_inventory_units(uuid, uuid, text)'
  );
  const orderLock =
    serializedInventoryConfirmation.findConfirmationLocks(release).order;
  const branches = extractIfBranches(
    release,
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );
  const decoyRelease = `PERFORM $decoy$${release}$decoy$;\nIF v_target_status = 'available' THEN\nNULL;\nELSE\nNULL;\nEND IF;`;
  const decoyBranches = extractIfBranches(
    decoyRelease,
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );
  assert.equal(releaseBranchesMatch(decoyBranches, decoyRelease), false);
  const executablePublicRelease = serializedInventorySqlParser.maskSqlLiterals(
    publicRelease,
    {
      preserveStrings: true,
    }
  );
  const executableRelease = serializedInventorySqlParser.maskSqlLiterals(
    release,
    { preserveStrings: true }
  );

  assert.equal(hasTargetStatusWhitelist(release), true);
  const authorizationGuard =
    /IF\s+COALESCE\(\s*\(\s*SELECT\s+auth\.role\(\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\.has_merchant_access\(p_merchant_id\)\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?RAISE\s+EXCEPTION\s+['"]forbidden['"](?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i;
  assert.match(executableRelease, authorizationGuard);
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      executableRelease,
      authorizationGuard.exec(executableRelease).index,
      orderLock.index
    ),
    true
  );
  assert.doesNotMatch(
    executableRelease.replace(authorizationGuard, ''),
    authorizationGuard
  );
  assert.doesNotMatch(
    serializedInventorySqlParser.maskSqlLiterals(
      release.replace(
        authorizationGuard,
        (guard) => `PERFORM $decoy$${guard}$decoy$;`
      ),
      { preserveStrings: true }
    ),
    authorizationGuard
  );
  assert.ok(orderLock, 'release must lock its parent order');
  assert.equal(
    serializedInventoryConfirmation.orderLockFailsClosed(release),
    true,
    'release must fail closed when its scoped parent order does not exist'
  );
  assert.equal(
    serializedInventoryConfirmation.orderLockFailsClosed(
      release.replace(
        /IF\s+NOT\s+FOUND\s+THEN\s+RAISE\s+EXCEPTION\s+'order_not_found'[^;]*;\s*END\s+IF\s*;/i,
        (handler) => `PERFORM 1;\n${handler}`
      )
    ),
    false
  );
  assert.ok(
    orderLock.index < release.indexOf("IF v_target_status = 'available'"),
    'release must lock its parent order before inventory reconciliation'
  );
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      executableRelease,
      orderLock.index,
      executableRelease.indexOf("IF v_target_status = 'available'")
    ),
    true
  );
  assert.equal(releaseBranchesMatch(branches, release), true);
  const reconciliationLoop =
    /FOR\s+v_item\s+IN\s+SELECT\s+(?:oi\s*\.\s*\*|oi\s*\.\s*id\s*,\s*oi\s*\.\s*product_id\s*,\s*oi\s*\.\s*quantity)[\s\S]*?END\s+LOOP\s*;/i.exec(
      release
    );
  assert.ok(reconciliationLoop);
  const withoutReconciliation = release.replace(reconciliationLoop[0], '');
  assert.equal(
    releaseBranchesMatch(
      extractIfBranches(
        withoutReconciliation,
        /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/im
      ),
      withoutReconciliation
    ),
    false
  );
  assert.match(
    executablePublicRelease,
    /RETURN\s+private\s*\.\s*release_order_inventory_units\s*\(\s*p_merchant_id\s*,\s*p_order_id\s*,\s*p_target_status\s*\)\s*;/i,
    'public release must delegate all validated parameters unchanged'
  );
  assert.doesNotMatch(
    serializedInventorySqlParser.maskSqlLiterals(
      publicRelease.replace(
        /RETURN\s+private\s*\.\s*release_order_inventory_units[\s\S]*?;/i,
        "$decoy$RETURN private.release_order_inventory_units(p_merchant_id, p_order_id, p_target_status);$decoy$ RETURN '{}'::jsonb;"
      ),
      { preserveStrings: true }
    ),
    /RETURN\s+private\s*\.\s*release_order_inventory_units/i
  );
  const elsifRelease = release.replace(
    /\s+ELSE\s+/i,
    "\nELSIF v_target_status = 'returned' THEN\n  NULL;\nELSE\n"
  );
  assert.equal(
    releaseBranchesMatch(
      extractIfBranches(
        elsifRelease,
        /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/im
      ),
      elsifRelease
    ),
    false
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
        /UPDATE\s+public\.variant_inventory[\s\S]*?WHERE\s+id\s*=\s*v_unit\.id;/i,
        (update) => `IF false THEN\n${update}\nEND IF;`
      ),
      'available'
    ),
    false
  );
  assert.equal(
    releaseTransition(
      branches.thenBranch.replace(
        'WHERE id = v_unit.id;',
        "WHERE id = v_unit.id AND status = 'available';"
      ),
      'available'
    ),
    false
  );
  assert.equal(
    hasTargetStatusWhitelist(
      release.replace(
        /IF\s+v_target_status\s+NOT\s+IN[\s\S]*?END\s+IF\s*;/i,
        ''
      )
    ),
    false
  );
  assert.equal(
    hasTargetStatusWhitelist(
      release.replace(
        /COALESCE\s*\(\s*p_target_status\s*,\s*'available'\s*\)/i,
        'p_target_status'
      )
    ),
    false
  );
  assert.equal(
    hasTargetStatusWhitelist(
      release.replace(
        /IF\s+v_target_status\s+NOT\s+IN[\s\S]*?END\s+IF\s*;/i,
        (guard) => `IF false THEN\n${guard}\nEND IF;`
      )
    ),
    false
  );
  assert.equal(
    hasTargetStatusWhitelist(
      release.replace(
        /(IF\s+v_target_status\s+NOT\s+IN[\s\S]*?END\s+IF\s*;)/i,
        (guard) => `${guard}\n  v_target_status := 'returned';`
      )
    ),
    false,
    'release must not reassign target status after validating it'
  );
  assert.equal(
    hasTargetStatusWhitelist(
      release.replace(
        /PERFORM\s+1\s+FROM\s+public\.orders[\s\S]*?FOR\s+UPDATE\s*;/i,
        (orderLock) =>
          `${orderLock}\n  p_merchant_id := '00000000-0000-0000-0000-000000000001';\n  p_order_id := '00000000-0000-0000-0000-000000000002';`
      )
    ),
    false,
    'release must not reassign scoped parameters after locking the order'
  );
  assert.equal(
    releaseTransition(
      "UPDATE variant_inventory SET source = $$status = 'returned'$$ WHERE id = v_unit.id;",
      'returned'
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
  assert.equal(
    releaseTransition(
      branches.elseBranch.replace(
        "SET status = 'returned',",
        "SET status = 'returned', order_id = NULL, order_item_id = NULL,"
      ),
      'returned'
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
  assert.equal(
    releaseLockMatches(
      "FROM variant_inventory vi WHERE vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id AND vi.status = 'reserved' AND EXISTS (SELECT 1 FROM merchants m WHERE m.id = vi.merchant_id FOR UPDATE)"
    ),
    false
  );
  for (const unsafe of [
    'FROM orders o WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id FOR UPDATE OF o SKIP LOCKED;',
    'FROM orders o WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id FOR UPDATE OF o NOWAIT;',
    'FROM orders o JOIN merchants m ON m.id = o.merchant_id WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id FOR UPDATE OF m;',
  ]) {
    assert.equal(
      serializedInventoryConfirmation.findConfirmationLocks(unsafe).order,
      undefined
    );
  }
});
