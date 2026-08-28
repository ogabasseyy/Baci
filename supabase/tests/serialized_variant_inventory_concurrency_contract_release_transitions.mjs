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
    !serializedInventoryControlFlow.sharesInnermostLoop(
      searchableBranch,
      update.index,
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

function targetDispatchEnd(source) {
  const dispatch = /\bIF\s+v_target_status\s*=\s*'available'\s+THEN\b/i.exec(
    source
  );
  if (!dispatch) return undefined;
  const executable = serializedInventorySqlParser.maskSqlLiterals(source);
  let depth = 0;
  const tokens = /\bEND\s+IF\b|\bIF\b/gi;
  for (const token of executable.slice(dispatch.index).matchAll(tokens)) {
    if (/^IF$/i.test(token[0])) {
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        return dispatch.index + token.index + token[0].length;
      }
    }
  }
  return undefined;
}

function releaseReconciliationMatches(source) {
  const normalizedSource =
    serializedInventorySqlParser.stripSqlComments(source);
  const executable = serializedInventorySqlParser.maskSqlLiterals(
    normalizedSource,
    {
      preserveStrings: true,
    }
  );
  const dispatchEnd = targetDispatchEnd(normalizedSource);
  if (dispatchEnd === undefined) return false;
  const afterDispatch = executable.slice(dispatchEnd);
  const loop =
    /FOR\s+v_item\s+IN\s+SELECT\s+(?:oi\s*\.\s*\*|oi\s*\.\s*id\s*,\s*oi\s*\.\s*product_id\s*,\s*oi\s*\.\s*quantity)[\s\S]*?FROM\s+(?:public\s*\.\s*)?order_items\s+oi[\s\S]*?WHERE\s+oi\s*\.\s*order_id\s*=\s*p_order_id[\s\S]*?FOR\s+UPDATE[\s\S]*?LOOP\b([\s\S]*?)END\s+LOOP\s*;/i.exec(
      afterDispatch
    );
  if (!loop) return false;
  const bodyStart = dispatchEnd + loop.index + loop[0].indexOf(loop[1]);
  const snapshot =
    /SELECT\s+jsonb_agg\s*\([\s\S]*?\)\s+INTO\s+v_units_json[\s\S]*?FROM\s+(?:public\s*\.\s*)?variant_inventory\s+vi[\s\S]*?WHERE\s+vi\s*\.\s*order_item_id\s*=\s*v_item\s*\.\s*id\s*;/i.exec(
      loop[1]
    );
  const fulfillment =
    /UPDATE\s+(?:public\s*\.\s*)?order_items\s+SET\s+fulfillment_data\s*=\s*v_fulfillment_data\s+WHERE\s+id\s*=\s*v_item\s*\.\s*id\s*;/i.exec(
      loop[1]
    );
  const sync =
    /PERFORM\s+private\s*\.\s*sync_serialized_stock\s*\(\s*p_merchant_id\s*,\s*v_item\s*\.\s*product_id\s*\)\s*;/i.exec(
      loop[1]
    );
  const preservedFulfillmentGuard =
    /IF\s+array_position\(\s*v_released_order_item_ids\s*,\s*v_item\s*\.\s*id\s*\)\s+IS\s+NULL\s+THEN\s+CONTINUE\s*;\s*END\s+IF\s*;/i.exec(
      loop[1]
    );
  if (!snapshot || !fulfillment || !sync || !preservedFulfillmentGuard)
    return false;
  const indexes = [snapshot, fulfillment, sync].map(
    (match) => bodyStart + match.index
  );
  const guardIndex = bodyStart + preservedFulfillmentGuard.index;
  return (
    serializedInventoryControlFlow.sharesInnermostLoop(
      executable,
      ...indexes
    ) &&
    indexes.every((index) =>
      serializedInventoryControlFlow.dominatesControlFlow(
        executable,
        guardIndex,
        index
      )
    ) &&
    indexes.every((index) =>
      serializedInventoryControlFlow.isReachable(executable, index)
    )
  );
}

function releaseBranchesMatch(branches, source) {
  return (
    source !== undefined &&
    branches.elsifBranches.length === 0 &&
    serializedInventoryReleaseLocks.releaseLockMatches(branches.thenBranch) &&
    serializedInventoryReleaseLocks.releaseLockMatches(branches.elseBranch) &&
    releaseTransition(branches.thenBranch, 'available') &&
    releaseTransition(branches.elseBranch, 'returned') &&
    releaseReconciliationMatches(source)
  );
}

export const serializedInventoryReleaseTransitions = {
  releaseBranchesMatch,
  releaseReconciliationMatches,
  releaseTransition,
};
