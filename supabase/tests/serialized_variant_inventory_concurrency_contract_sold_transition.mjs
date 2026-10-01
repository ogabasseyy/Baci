import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventoryExceptionHandlers } from './serialized_variant_inventory_concurrency_contract_exception_handlers.mjs';
import { serializedInventorySelectInto } from './serialized_variant_inventory_concurrency_contract_select_into.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { maskSqlLiterals, splitTopLevelList, stripSqlComments } =
  serializedInventorySqlParser;

const allowedSoldAssignments = new Set([
  "status = 'sold'",
  'sold_at = now()',
  'updated_at = now()',
]);

const allowedSoldPredicates = new Set([
  'id = v_unit.id',
  "status = 'reserved'",
]);

function normalizeSoldFragment(fragment) {
  let normalized = fragment
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*=\s*/g, ' = ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
  while (
    normalized.startsWith('(') &&
    normalized.endsWith(')') &&
    normalized.length > 2
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function isExactSoldTransition(setClause, whereClause) {
  const assignments = splitTopLevelList(setClause).map(normalizeSoldFragment);
  if (
    assignments.length === 0 ||
    !assignments.includes("status = 'sold'") ||
    !assignments.every((assignment) => allowedSoldAssignments.has(assignment))
  ) {
    return false;
  }
  const predicates = whereClause
    .split(/\bAND\b/i)
    .map(normalizeSoldFragment)
    .filter(Boolean);
  return (
    predicates.length === allowedSoldPredicates.size &&
    predicates.every((predicate) => allowedSoldPredicates.has(predicate))
  );
}

function soldTransitionInLockedLoop(source) {
  const cleanSource = maskSqlLiterals(stripSqlComments(source), {
    preserveStrings: true,
  });
  const loop = /FOR\s+v_unit\s+IN\b[\s\S]*?\bLOOP\b/i.exec(cleanSource);
  if (!loop) return false;
  const bodyStart = loop.index + loop[0].length;
  const transition =
    /UPDATE\s+(?:public\s*\.\s*)?variant_inventory\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*?);/i.exec(
      cleanSource.slice(bodyStart)
    );
  if (transition && !isExactSoldTransition(transition[1], transition[2])) {
    return false;
  }
  if (!transition) return false;
  const transitionIndex = bodyStart + transition.index;
  const guard = soldGuardPattern.exec(cleanSource);
  return (
    serializedInventoryControlFlow.sharesInnermostLoop(
      cleanSource,
      bodyStart,
      transitionIndex
    ) &&
    serializedInventoryControlFlow.isReachable(cleanSource, transitionIndex) &&
    !serializedInventoryExceptionHandlers.indexInExceptionHandler(
      cleanSource,
      transitionIndex
    ) &&
    (!guard ||
      !serializedInventoryExceptionHandlers.enclosingAuthorizationHandler(
        cleanSource,
        guard.index
      ))
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
  const scopeWindow =
    guard && selector && guard.index < selector.index
      ? cleanSource.slice(guard.index, selector.index)
      : null;
  const scopeReassignment =
    scopeWindow === null
      ? true
      : /(?:^|[;\n])\s*p_(?:merchant_id|order_id)\s*(?::=|=(?!=))/im.test(
          scopeWindow
        ) ||
        serializedInventorySelectInto.selectIntoWritesVariable(
          scopeWindow,
          'p_merchant_id'
        ) ||
        serializedInventorySelectInto.selectIntoWritesVariable(
          scopeWindow,
          'p_order_id'
        );
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
      !serializedInventoryExceptionHandlers.enclosingAuthorizationHandler(
        cleanSource,
        guard.index
      ) &&
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
