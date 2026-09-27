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

function soldGuardDominatesUnits(source) {
  const cleanSource = maskSqlLiterals(stripSqlComments(source), {
    preserveStrings: true,
  });
  const guard =
    /IF\s+COALESCE\(\s*\(\s*SELECT\s+auth\.role\(\s*\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\.has_merchant_access\(\s*p_merchant_id\s*\)\s+THEN\b/i.exec(
      cleanSource
    );
  const selector = /FOR\s+v_unit\s+IN\b/i.exec(cleanSource);
  return Boolean(
    guard &&
      selector &&
      guard.index < selector.index &&
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
