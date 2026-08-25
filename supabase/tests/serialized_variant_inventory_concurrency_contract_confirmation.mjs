import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const {
  isRequiredConjunct,
  maskSqlLiterals,
  splitSqlStatements,
  stripSqlComments,
} = serializedInventorySqlParser;

function findConfirmationLocks(source) {
  const statements = splitSqlStatements(
    maskSqlLiterals(stripSqlComments(source))
  );
  function find(table, predicates) {
    for (const { index, text } of statements) {
      const query = new RegExp(
        `FROM\\s+(?:public\\s*\\.\\s*)?${table}(?:\\s+(?:AS\\s+)?([a-z_][a-z0-9_]*))?[^;]*?WHERE\\s+([\\s\\S]*?)FOR\\s+UPDATE(?!\\s+(?:OF\\s+[a-z_][a-z0-9_]*\\s+)?(?:SKIP\\s+LOCKED|NOWAIT)\\b)`,
        'i'
      ).exec(text);
      if (
        query &&
        predicates(query[1]).every((predicate) =>
          isRequiredConjunct(query[2], predicate)
        )
      ) {
        return { index: index + query.index, where: query[2] };
      }
    }
    return undefined;
  }
  return {
    item: find('order_items', (alias) => [
      new RegExp(
        `(?:${alias ? `${alias}\\s*\\.\\s*` : ''})order_id\\s*=\\s*p_order_id\\b`,
        'i'
      ),
    ]),
    order: find('orders', (alias) => [
      new RegExp(
        `(?:${alias ? `${alias}\\s*\\.\\s*` : ''})id\\s*=\\s*p_order_id\\b`,
        'i'
      ),
      new RegExp(
        `(?:${alias ? `${alias}\\s*\\.\\s*` : ''})merchant_id\\s*=\\s*p_merchant_id\\b`,
        'i'
      ),
    ]),
  };
}

export const serializedInventoryConfirmation = { findConfirmationLocks };
