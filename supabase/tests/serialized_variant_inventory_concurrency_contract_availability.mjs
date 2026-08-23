import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { isRequiredConjunct, splitSqlStatements, stripSqlComments } =
  serializedInventorySqlParser;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function availableUnitWhereClause(source) {
  const cleanSource = stripSqlComments(source);
  for (const { text } of splitSqlStatements(cleanSource)) {
    const match =
      /FROM\s+(?:public\s*\.\s*)?variant_inventory(?:\s+(?:AS\s+)?(?!WHERE\b|ORDER\b|LIMIT\b|FOR\b)([a-z_][a-z0-9_]*))?\s+WHERE\b([\s\S]*?)\bORDER\s+BY\b[\s\S]*?\bLIMIT\s+v_needed\s+FOR\s+UPDATE\s+SKIP\s+LOCKED/i.exec(
        text
      );
    if (match) return { alias: match[1], where: match[2] };
  }
  return null;
}

function availableUnitPredicatePatterns(variantVariable, alias) {
  const qualifier = alias
    ? `${escapeRegex(alias)}\\s*\\.\\s*`
    : '(?:(?:[a-z_][a-z0-9_]*)\\s*\\.\\s*)?';
  return [
    new RegExp(`${qualifier}merchant_id\\s*=\\s*p_merchant_id`, 'i'),
    new RegExp(
      `${qualifier}variant_id\\s*=\\s*${escapeRegex(variantVariable)}`,
      'i'
    ),
    new RegExp(`${qualifier}status\\s*=\\s*'available'`, 'i'),
    new RegExp(`${qualifier}order_id\\s+IS\\s+NULL`, 'i'),
    new RegExp(`${qualifier}order_item_id\\s+IS\\s+NULL`, 'i'),
    new RegExp(`${qualifier}sold_at\\s+IS\\s+NULL`, 'i'),
  ];
}

function availableUnitPredicatesMatch(source, variantVariable) {
  const query = availableUnitWhereClause(source);
  return (
    query !== null &&
    availableUnitPredicatePatterns(variantVariable, query.alias).every(
      (pattern) => isRequiredConjunct(query.where, pattern)
    )
  );
}

export const serializedInventoryAvailability = {
  availableUnitPredicatesMatch,
};
