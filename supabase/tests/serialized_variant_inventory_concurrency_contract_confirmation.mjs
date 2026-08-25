import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const {
  isRequiredConjunct,
  maskSqlLiterals,
  splitSqlStatements,
  stripSqlComments,
} = serializedInventorySqlParser;

function maskNestedQueries(source) {
  let output = '';
  for (let index = 0; index < source.length; index += 1) {
    if (
      source[index] !== '(' ||
      !/^\(\s*(?:SELECT|WITH|VALUES|TABLE)\b/i.test(source.slice(index))
    ) {
      output += source[index];
      continue;
    }
    let depth = 0;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      output += char === '\n' || char === '\r' ? char : ' ';
      if (depth === 0) break;
    }
  }
  return output;
}

function findConfirmationLocks(source) {
  const statements = splitSqlStatements(
    maskNestedQueries(maskSqlLiterals(stripSqlComments(source)))
  );
  function find(table, predicates) {
    for (const { index, text } of statements) {
      const query = new RegExp(
        `FROM\\s+(?:public\\s*\\.\\s*)?${table}(?:\\s+(?:AS\\s+)?([a-z_][a-z0-9_]*))?[^;]*?WHERE\\s+([\\s\\S]*?)FOR\\s+UPDATE(?!\\s+(?:OF\\s+[a-z_][a-z0-9_]*\\s+)?(?:SKIP\\s+LOCKED|NOWAIT)\\b)`,
        'i'
      ).exec(text);
      if (
        query &&
        !/\b(?:LIMIT|OFFSET|FETCH)\b/i.test(query[2]) &&
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
