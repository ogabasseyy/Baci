import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

function hasPositiveQuantityGuard(source) {
  const executable = serializedInventorySqlParser.maskSqlLiterals(source, {
    preserveStrings: true,
  });
  const guard =
    /IF\s+quantity_param\s*<=\s*0\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?\bRETURN\b(?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.exec(
      executable
    );
  const protectedOperations = [
    ...executable.matchAll(
      /SELECT\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?stock_quantity\s+INTO[\s\S]*?\bFOR\s+UPDATE\b|UPDATE\s+(?:public\s*\.\s*)?(?:products|product_variants)\b/gi
    ),
  ];
  return Boolean(
    guard &&
      protectedOperations.length > 0 &&
      protectedOperations.every((operation) =>
        serializedInventoryControlFlow.dominatesControlFlow(
          executable,
          guard.index,
          operation.index
        )
      )
  );
}

function targetMerchantLookup(source, beforeIndex) {
  const targetParameter = /\bvariant_id_param\b/i.test(source)
    ? 'variant_id_param'
    : 'product_id_param';
  const targetPattern =
    targetParameter === 'variant_id_param'
      ? /SELECT\s+[^;]*\bmerchant_id\b[^;]*\bINTO\s+v_merchant_id\b[^;]*\bFROM\s+(?:public\s*\.\s*)?products\b[^;]*\bJOIN\s+(?:public\s*\.\s*)?product_variants\b[^;]*\bWHERE\s+[^;]*\bvariant_id_param\b[^;]*;/i
      : /SELECT\s+[^;]*\bmerchant_id\b[^;]*\bINTO\s+v_merchant_id\b[^;]*\bFROM\s+(?:public\s*\.\s*)?products\b[^;]*\bWHERE\s+[^;]*\bid\s*=\s*product_id_param\b[^;]*;/i;
  const assignments = [
    ...source.matchAll(
      /SELECT\s+[^;]*\bmerchant_id\b[^;]*\bINTO\s+v_merchant_id\b[^;]*;/gi
    ),
  ].filter(({ index }) => index < beforeIndex);
  const latestAssignment = assignments.at(-1);
  return latestAssignment && targetPattern.test(latestAssignment[0])
    ? latestAssignment
    : null;
}

function hasMerchantAuthorizationGuard(source) {
  const executable = serializedInventorySqlParser.maskSqlLiterals(source, {
    preserveStrings: true,
  });
  const guard =
    /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\s*\.\s*role\s*\(\s*\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\s*\.\s*has_merchant_access\s*\(\s*v_merchant_id\s*\)\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?\bRETURN\b(?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.exec(
      executable
    );
  const protectedOperation =
    /(?:SELECT\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?stock_quantity\s+INTO[\s\S]*?\bFOR\s+UPDATE\b|UPDATE\s+(?:public\s*\.\s*)?(?:products|product_variants)\b)/i.exec(
      executable
    );
  const merchantLookup = targetMerchantLookup(executable, guard?.index ?? -1);
  return Boolean(
    guard &&
      merchantLookup &&
      protectedOperation &&
      serializedInventoryControlFlow.dominatesControlFlow(
        executable,
        merchantLookup.index,
        guard.index
      ) &&
      serializedInventoryControlFlow.dominatesControlFlow(
        executable,
        guard.index,
        protectedOperation.index
      )
  );
}

function hasUnlimitedStockReturn(source) {
  const executable = serializedInventorySqlParser.maskSqlLiterals(source, {
    preserveStrings: true,
  });
  const guard =
    /IF\s+NOT\s+COALESCE\s*\(\s*v_manage_stock\s*,\s*false\s*\)\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?\bRETURN\b(?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.exec(
      executable
    );
  const protectedOperation =
    /(?:SELECT\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?stock_quantity\s+INTO[\s\S]*?\bFOR\s+UPDATE\b|UPDATE\s+(?:public\s*\.\s*)?(?:products|product_variants)\b)/i.exec(
      executable
    );
  return Boolean(
    guard &&
      protectedOperation &&
      serializedInventoryControlFlow.dominatesControlFlow(
        executable,
        guard.index,
        protectedOperation.index
      )
  );
}

function decrementsRequestedQuantity(source) {
  const executable = serializedInventorySqlParser.maskSqlLiterals(source, {
    preserveStrings: true,
  });
  return /\bstock_quantity\s*=\s*(?:[a-z_][a-z0-9_]*\s*\.\s*)?stock_quantity\s*-\s*quantity_param\b(?!\s*[*/+%-])/i.test(
    executable
  );
}

export const serializedInventoryDecrementGuards = {
  decrementsRequestedQuantity,
  hasMerchantAuthorizationGuard,
  hasPositiveQuantityGuard,
  hasUnlimitedStockReturn,
};
