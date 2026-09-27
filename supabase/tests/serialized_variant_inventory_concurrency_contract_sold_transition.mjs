import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { maskSqlLiterals, stripSqlComments } = serializedInventorySqlParser;

function soldTransitionInLockedLoop(source) {
  const cleanSource = maskSqlLiterals(stripSqlComments(source), {
    preserveStrings: true,
  });
  const loop = /FOR\s+v_unit\s+IN\b[\s\S]*?\bLOOP\b/i.exec(cleanSource);
  if (!loop) return false;
  const bodyStart = loop.index + loop[0].length;
  const transition =
    /UPDATE\s+(?:public\s*\.\s*)?variant_inventory\s+SET\s+[^;]*?\bstatus\s*=\s*'sold'[^;]*?\bWHERE\b[^;]*?\bid\s*=\s*v_unit\s*\.\s*id\b[^;]*?;/i.exec(
      cleanSource.slice(bodyStart)
    );
  if (!transition) return false;
  const transitionIndex = bodyStart + transition.index;
  return (
    serializedInventoryControlFlow.sharesInnermostLoop(
      cleanSource,
      bodyStart,
      transitionIndex
    ) &&
    serializedInventoryControlFlow.isReachable(cleanSource, transitionIndex)
  );
}

const soldGuardPattern =
  /IF\s+COALESCE\(\s*\(\s*SELECT\s+auth\.role\(\s*\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\.has_merchant_access\(\s*p_merchant_id\s*\)\s+THEN\b/i;

function unauthorizedArmAborts(thenBranch) {
  const masked = maskSqlLiterals(thenBranch);
  if (/\bEXCEPTION\s+WHEN\b/i.test(masked)) return false;
  let depth = 0;
  for (const token of masked.matchAll(
    /\bEND\s+IF\b|\bIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bRAISE\s+EXCEPTION\b/gi
  )) {
    if (/^END\s+IF/i.test(token[0])) depth = Math.max(0, depth - 1);
    else if (/^IF\b/i.test(token[0])) depth += 1;
    else if (depth === 0) return true;
  }
  return false;
}

function soldGuardDominatesUnits(source) {
  const cleanSource = maskSqlLiterals(stripSqlComments(source), {
    preserveStrings: true,
  });
  const guard = soldGuardPattern.exec(cleanSource);
  const selector = /FOR\s+v_unit\s+IN\b/i.exec(cleanSource);
  const scopeReassignment =
    guard && selector && guard.index < selector.index
      ? /(?:^|[;\n])\s*p_(?:merchant_id|order_id)\s*(?::=|=(?!=))/im.test(
          cleanSource.slice(guard.index, selector.index)
        )
      : true;
  let arms;
  try {
    arms = serializedInventoryBranches.extractIfArms(
      cleanSource,
      soldGuardPattern
    );
  } catch {
    return false;
  }
  return Boolean(
    guard &&
      selector &&
      guard.index < selector.index &&
      unauthorizedArmAborts(arms.thenBranch) &&
      !scopeReassignment &&
      serializedInventoryControlFlow.dominatesControlFlow(
        cleanSource,
        guard.index,
        selector.index
      )
  );
}

export const serializedInventorySoldTransition = {
  soldGuardDominatesUnits,
  soldTransitionInLockedLoop,
};
