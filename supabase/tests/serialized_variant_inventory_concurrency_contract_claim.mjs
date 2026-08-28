import { serializedInventoryAvailability } from './serialized_variant_inventory_concurrency_contract_availability.mjs';
import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { maskSqlLiterals } = serializedInventorySqlParser;

function hasOnlyUnitIdPredicate(whereClause) {
  return (
    whereClause
      .replace(/(?:[a-z_][a-z0-9_]*\s*\.\s*)?id\s*=\s*v_unit\.id\b/i, '')
      .replace(/[\s();]/g, '') === ''
  );
}

function findEffectiveReserveUpdate(source) {
  const updatePattern =
    /UPDATE\s+(?:public\s*\.\s*)?variant_inventory\s+SET\s+([^;]*?)\s+WHERE\s+([^;]*);/gi;
  const masked = maskSqlLiterals(source, { preserveStrings: true });
  const selector =
    serializedInventoryAvailability.availableUnitWhereClause(masked);
  const counters = [
    ...masked.matchAll(/v_claimed_count\s*:=\s*v_claimed_count\s*\+\s*1/gi),
  ];
  if (!selector || counters.length !== 1) return undefined;
  const [counter] = counters;
  return [...masked.matchAll(updatePattern)].find(
    (update) =>
      /\bstatus\s*=\s*'reserved'/i.test(update[1]) &&
      /\border_id\s*=\s*p_order_id\b/i.test(update[1]) &&
      /\border_item_id\s*=\s*p_order_item_id\b/i.test(update[1]) &&
      /\bbranch_id\s*=\s*v_unit_branch_id\b/i.test(update[1]) &&
      /\breservation_expires_at\s*=\s*CASE\s+WHEN\s+v_is_confirmed_hold\s+THEN\s+NULL\s+ELSE\s+now\(\)\s*\+\s*interval\s+'2 hours'\s+END\b/i.test(
        update[1]
      ) &&
      serializedInventoryControlFlow.dominatesControlFlow(
        masked,
        update.index,
        counter.index
      ) &&
      serializedInventoryControlFlow.sharesInnermostLoop(
        masked,
        selector.index,
        update.index,
        counter.index
      )
  );
}

function claimedIncrementCount(source) {
  return (
    maskSqlLiterals(source).match(
      /\bv_claimed_count\s*:=\s*v_claimed_count\s*\+\s*1\b/gi
    ) ?? []
  ).length;
}

function findEffectiveExcessRelease(source) {
  const executable = maskSqlLiterals(source, { preserveStrings: true });
  const excessBranch = /\bELSIF\s+v_reserved_count\s*>\s*v_qty\s+THEN\b/i.exec(
    executable
  );
  if (!excessBranch) return undefined;
  const releaseUpdate =
    /UPDATE\s+(?:public\s*\.\s*)?variant_inventory\s+SET\s+([^;]*?)\s+WHERE\s+([^;]*);/gi;
  return [...executable.matchAll(releaseUpdate)].find((update) => {
    if (update.index <= excessBranch.index) return false;
    if (
      !/\bstatus\s*=\s*'available'/i.test(update[1]) ||
      !/\border_id\s*=\s*NULL/i.test(update[1]) ||
      !/\border_item_id\s*=\s*NULL/i.test(update[1]) ||
      !/\bid\s*=\s*v_unit_id\b/i.test(update[2])
    ) {
      return false;
    }
    const preceding = executable.slice(excessBranch.index, update.index);
    return (
      /\bFOR\s+v_unit_id\s+IN\s*[\s\S]*?\bSELECT\s+id\s+FROM\s+(?:public\s*\.\s*)?variant_inventory\b[\s\S]*?\border_item_id\s*=\s*p_order_item_id\b[\s\S]*?\bstatus\s*=\s*'reserved'[\s\S]*?\bLIMIT\s+v_excess\s+LOOP\b/i.test(
        preceding
      ) && serializedInventoryControlFlow.isReachable(executable, update.index)
    );
  });
}

function topLevelRaiseIndex(source) {
  const searchable = serializedInventorySqlParser.maskSqlLiterals(source);
  let depth = 0;
  let caseDepth = 0;
  for (const token of searchable.matchAll(
    /\bEND\s+IF\b|\bEND\s+CASE\b|\bIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bCASE\b|\bRAISE\s+EXCEPTION\b/gi
  )) {
    if (/^END\s+IF/i.test(token[0])) depth = Math.max(0, depth - 1);
    else if (/^IF\b/i.test(token[0])) depth += 1;
    else if (/^END\s+CASE/i.test(token[0]))
      caseDepth = Math.max(0, caseDepth - 1);
    else if (/^CASE$/i.test(token[0])) caseDepth += 1;
    else if (depth === 0 && caseDepth === 0) return token.index;
  }
  return -1;
}

function strictShortagePrecedesSuccess(source) {
  const executable = maskSqlLiterals(source, { preserveStrings: true });
  const target =
    /^\s*IF\s+v_effective_policy\s*=\s*'serialized_strict'\s+AND\s+(?:\(\s*)?v_reserved_count\s*\+\s*v_claimed_count\s*(?:\s*\))?\s*<\s*v_qty\s+THEN\b/im;
  const guard = target.exec(executable);
  const success = /RETURN\s+v_fulfillment_data\s*;/i.exec(executable);
  if (
    !guard ||
    !success ||
    guard.index >= success.index ||
    !serializedInventoryControlFlow.isReachable(executable, guard.index)
  )
    return false;
  try {
    const branches = serializedInventoryBranches.extractIfArms(
      executable,
      target
    );
    const raiseOffset = topLevelRaiseIndex(branches.thenBranch);
    if (raiseOffset < 0) return false;
    const branchStart = executable.indexOf(
      branches.thenBranch,
      guard.index + guard[0].length
    );
    if (branchStart < 0) return false;
    const raiseIndex = branchStart + raiseOffset;
    return (
      raiseIndex < success.index &&
      serializedInventoryControlFlow.isReachable(executable, raiseIndex)
    );
  } catch {
    return false;
  }
}

export const serializedInventoryClaim = {
  claimedIncrementCount,
  findEffectiveExcessRelease,
  findEffectiveReserveUpdate,
  hasOnlyUnitIdPredicate,
  strictShortagePrecedesSuccess,
};
