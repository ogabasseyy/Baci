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
  return Boolean(
    guard && protectedOperation && guard.index < protectedOperation.index
  );
}

function hasUnlimitedStockReturn(source) {
  const executable = serializedInventorySqlParser.maskSqlLiterals(source, {
    preserveStrings: true,
  });
  return /IF\s+NOT\s+COALESCE\s*\(\s*v_manage_stock\s*,\s*false\s*\)\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?\bRETURN\b(?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.test(
    executable
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
