import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryConfirmation } from './serialized_variant_inventory_concurrency_contract_confirmation.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventoryReleaseLocks } from './serialized_variant_inventory_concurrency_contract_release_locks.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { extractIfBranches, latestFunctionBody } = serializedInventoryContract;
const { releaseLockMatches } = serializedInventoryReleaseLocks;

function releaseTransition(branch, targetStatus) {
  const searchableBranch = serializedInventorySqlParser.maskSqlLiterals(
    branch,
    {
      preserveStrings: true,
    }
  );
  const update =
    /UPDATE\s+(?:public\s*\.\s*)?variant_inventory\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*?);/i.exec(
      searchableBranch
    );
  const counters = [
    ...searchableBranch.matchAll(/\bv_count\s*:=\s*v_count\s*\+\s*1\b/gi),
  ];
  if (
    !update ||
    counters.length !== 1 ||
    !serializedInventoryControlFlow.dominatesControlFlow(
      searchableBranch,
      update.index,
      counters[0].index
    ) ||
    !new RegExp(`\\bstatus\\s*=\\s*'${targetStatus}'`, 'i').test(update[1])
  ) {
    return false;
  }
  const clearsOwnership =
    targetStatus === 'available'
      ? [
          'order_id',
          'order_item_id',
          'reserved_at',
          'reservation_expires_at',
        ].every((column) =>
          new RegExp(`\\b${column}\\s*=\\s*NULL\\b`, 'i').test(update[1])
        )
      : !/\b(?:order_id|order_item_id)\s*=/i.test(update[1]);
  return (
    clearsOwnership &&
    /^(?:\s*\(\s*)*(?:[a-z_][a-z0-9_]*\s*\.\s*)?id\s*=\s*v_unit\s*\.\s*id(?:\s*\)\s*)*$/i.test(
      update[2]
    )
  );
}

function hasReleaseTargetStatusWhitelist(source) {
  const defaultStatus =
    /\bv_target_status\s+text\s*:=\s*COALESCE\s*\(\s*p_target_status\s*,\s*'available'\s*\)\s*;/i.exec(
      source
    );
  const guard =
    /IF\s+v_target_status\s+NOT\s+IN\s*\(\s*'available'\s*,\s*'returned'\s*\)\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?RAISE\s+EXCEPTION\s+['"]invalid_target_status['"](?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.exec(
      source
    );
  return Boolean(
    defaultStatus &&
      guard &&
      defaultStatus.index < guard.index &&
      guard.index < source.indexOf("IF v_target_status = 'available'")
  );
}

function releaseBranchesMatch(branches) {
  return (
    branches.elsifBranches.length === 0 &&
    releaseLockMatches(branches.thenBranch) &&
    releaseLockMatches(branches.elseBranch) &&
    releaseTransition(branches.thenBranch, 'available') &&
    releaseTransition(branches.elseBranch, 'returned')
  );
}

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
  const decoyBranches = extractIfBranches(
    `PERFORM $decoy$${release}$decoy$;\nIF v_target_status = 'available' THEN\nNULL;\nELSE\nNULL;\nEND IF;`,
    /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i
  );
  assert.equal(releaseBranchesMatch(decoyBranches), false);
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

  assert.equal(hasReleaseTargetStatusWhitelist(release), true);
  const authorizationGuard =
    /IF\s+auth\.role\(\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\.has_merchant_access\(p_merchant_id\)\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?RAISE\s+EXCEPTION\s+['"]forbidden['"](?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i;
  assert.match(executableRelease, authorizationGuard);
  assert.ok(authorizationGuard.exec(executableRelease).index < orderLock.index);
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
  assert.match(
    release.slice(orderLock.index),
    /FOR\s+UPDATE(?:\s+OF\s+[a-z_][a-z0-9_]*)?\s*;\s*IF\s+NOT\s+FOUND\s+THEN\s+RAISE\s+EXCEPTION\s+['"]order_not_found['"]/i,
    'release must fail closed when its scoped parent order does not exist'
  );
  assert.ok(
    orderLock.index < release.indexOf("IF v_target_status = 'available'"),
    'release must lock its parent order before inventory reconciliation'
  );
  assert.equal(releaseBranchesMatch(branches), true);
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
  assert.equal(
    releaseBranchesMatch(
      extractIfBranches(
        release.replace(
          /\s+ELSE\s+/i,
          "\nELSIF v_target_status = 'returned' THEN\n  NULL;\nELSE\n"
        ),
        /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/im
      )
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
    hasReleaseTargetStatusWhitelist(
      release.replace(
        /IF\s+v_target_status\s+NOT\s+IN[\s\S]*?END\s+IF\s*;/i,
        ''
      )
    ),
    false
  );
  assert.equal(
    hasReleaseTargetStatusWhitelist(
      release.replace(
        /COALESCE\s*\(\s*p_target_status\s*,\s*'available'\s*\)/i,
        'p_target_status'
      )
    ),
    false
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
