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
  return [
    /vi\s*\.\s*order_id\s*=\s*p_order_id\b/i,
    /vi\s*\.\s*merchant_id\s*=\s*p_merchant_id\b/i,
    /vi\s*\.\s*status\s*=\s*'reserved'/i,
  ].every((predicate) =>
    serializedInventorySqlParser.isRequiredConjunct(query[1], predicate)
  );
}

export const serializedInventoryReleaseLocks = { releaseLockMatches };
