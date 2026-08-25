import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

function hasPositiveQuantityGuard(source) {
  const executable = serializedInventorySqlParser.maskSqlLiterals(source, {
    preserveStrings: true,
  });
  return /IF\s+quantity_param\s*<=\s*0\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?\bRETURN\b(?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.test(
    executable
  );
}

function hasMerchantAuthorizationGuard(source) {
  const executable = serializedInventorySqlParser.maskSqlLiterals(source, {
    preserveStrings: true,
  });
  return /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\s*\.\s*role\s*\(\s*\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\s*\.\s*has_merchant_access\s*\(\s*v_merchant_id\s*\)\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?\bRETURN\b(?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i.test(
    executable
  );
}

export const serializedInventoryDecrementGuards = {
  hasMerchantAuthorizationGuard,
  hasPositiveQuantityGuard,
};
