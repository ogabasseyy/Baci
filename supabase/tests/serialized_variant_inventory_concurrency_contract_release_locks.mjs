import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventoryNestedQueries } from './serialized_variant_inventory_concurrency_contract_nested_queries.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

function releaseLockMatches(source) {
  const searchableSource = serializedInventoryNestedQueries.maskNestedQueries(
    serializedInventorySqlParser.maskSqlLiterals(source, {
      preserveStrings: true,
    })
  );
  const query =
    /FROM\s+(?:public\s*\.\s*)?variant_inventory\s+(?:AS\s+)?vi[\s\S]*?WHERE\s+([\s\S]*?)FOR\s+UPDATE(?:\s+OF\s+vi\b)?(?!\s+(?:OF\b|SKIP\s+LOCKED\b|NOWAIT\b))/i.exec(
      searchableSource
    );
  if (
    !query ||
    /\b(?:LIMIT|OFFSET|FETCH|FALSE)\b|\bNOT\s+TRUE\b/i.test(query[1])
  )
    return false;
  const statusComparisons = [
    ...query[1].matchAll(
      /\bvi\s*\.\s*status\s*(=|<>|!=|IS\s+(?:NOT\s+)?DISTINCT\s+FROM)\s*'([^']+)'/gi
    ),
  ];
  if (
    statusComparisons.some(
      ([, operator, value]) =>
        operator !== '=' || value.toLowerCase() !== 'reserved'
    ) ||
    /\bNOT\s*\(\s*vi\s*\.\s*status\s*=\s*'reserved'/i.test(query[1])
  ) {
    return false;
  }
  return [
    /vi\s*\.\s*order_id\s*=\s*p_order_id\b/i,
    /vi\s*\.\s*merchant_id\s*=\s*p_merchant_id\b/i,
    /vi\s*\.\s*status\s*=\s*'reserved'/i,
  ].every((predicate) =>
    serializedInventorySqlParser.isRequiredConjunct(query[1], predicate)
  );
}

function hasTargetStatusWhitelist(source) {
  const executable = serializedInventorySqlParser.maskSqlLiterals(source, {
    preserveStrings: true,
  });
  const defaultStatus =
    /\bv_target_status\s+text\s*:=\s*COALESCE\s*\(\s*p_target_status\s*,\s*'available'\s*\)\s*;/i.exec(
      executable
    );
  const guard =
    /IF\s+v_target_status\s+NOT\s+IN\s*\(\s*'available'\s*,\s*'returned'\s*\)\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?RAISE\s+EXCEPTION\s+['"]invalid_target_status['"](?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.exec(
      executable
    );
  const dispatch = /IF\s+v_target_status\s*=\s*'available'\s+THEN/i.exec(
    executable
  );
  return Boolean(
    defaultStatus &&
      guard &&
      dispatch &&
      defaultStatus.index < guard.index &&
      serializedInventoryControlFlow.dominatesControlFlow(
        executable,
        guard.index,
        dispatch.index
      )
  );
}

function findReleaseEvent(source, targetStatus) {
  const eventName =
    targetStatus === 'available' ? 'reservation_released' : 'returned';
  return new RegExp(
    `PERFORM\\s+private\\s*\\.\\s*record_variant_inventory_event\\s*\\(\\s*v_unit\\s*\\.\\s*id\\s*,\\s*p_merchant_id\\s*,\\s*v_unit\\s*\\.\\s*product_id\\s*,\\s*v_unit\\s*\\.\\s*variant_id\\s*,\\s*'${eventName}'\\s*,\\s*'reserved'\\s*,\\s*'${targetStatus}'\\s*,\\s*p_order_id\\s*,\\s*v_unit\\s*\\.\\s*order_item_id\\b[\\s\\S]*?\\);`,
    'i'
  ).exec(source);
}

export const serializedInventoryReleaseLocks = {
  findReleaseEvent,
  hasTargetStatusWhitelist,
  releaseLockMatches,
};
