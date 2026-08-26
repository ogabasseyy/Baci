import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventoryReleaseLocks } from './serialized_variant_inventory_concurrency_contract_release_locks.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

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
  const event = serializedInventoryReleaseLocks.findReleaseEvent(
    searchableBranch,
    targetStatus
  );
  if (
    !update ||
    counters.length !== 1 ||
    !event ||
    !serializedInventoryControlFlow.dominatesControlFlow(
      searchableBranch,
      update.index,
      counters[0].index
    ) ||
    !serializedInventoryControlFlow.dominatesControlFlow(
      searchableBranch,
      event.index,
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

function releaseBranchesMatch(branches) {
  return (
    branches.elsifBranches.length === 0 &&
    serializedInventoryReleaseLocks.releaseLockMatches(branches.thenBranch) &&
    serializedInventoryReleaseLocks.releaseLockMatches(branches.elseBranch) &&
    releaseTransition(branches.thenBranch, 'available') &&
    releaseTransition(branches.elseBranch, 'returned')
  );
}

export const serializedInventoryReleaseTransitions = {
  releaseBranchesMatch,
  releaseTransition,
};
