import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { isRequiredConjunct, splitSqlStatements, stripSqlComments } =
  serializedInventorySqlParser;

function columnEquals(column, value) {
  return new RegExp(
    `(?:[a-z_][a-z0-9_]*\\s*\\.\\s*)?${column}\\s*=\\s*${value}\\b`,
    'i'
  );
}

function lockQueries(source) {
  const cleanSource = stripSqlComments(source);
  return splitSqlStatements(cleanSource).flatMap(({ index, text }) => {
    const from =
      /FROM\s+(?:public\s*\.\s*)?(orders|order_items)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/i.exec(
        text
      );
    if (!from) return [];

    const segment = text.slice(from.index);
    const where = /\bWHERE\b([\s\S]*?)\bFOR\s+UPDATE\b/i.exec(segment);
    const lock = /\bFOR\s+UPDATE(?:\s+OF\s+([a-z_][a-z0-9_]*))?/i.exec(segment);
    if (!where || !lock) return [];

    return [
      {
        alias: from[2]?.toLowerCase(),
        index: index + from.index,
        lockTarget: lock[1]?.toLowerCase(),
        table: from[1].toLowerCase(),
        text: segment,
        where: where[1],
      },
    ];
  });
}

function lockTargetsRow(query) {
  return (
    !query.lockTarget ||
    (query.alias !== undefined && query.lockTarget === query.alias)
  );
}

function matchesPredicates(query, patterns) {
  return (
    query !== undefined &&
    patterns.every((pattern) => isRequiredConjunct(query.where, pattern))
  );
}

function findClaimLocks(source) {
  const queries = lockQueries(source);
  const order = queries.find(
    (query) =>
      query.table === 'orders' &&
      lockTargetsRow(query) &&
      matchesPredicates(query, [
        columnEquals('id', 'p_order_id'),
        columnEquals('merchant_id', 'p_merchant_id'),
      ])
  );
  const item = queries.find(
    (query) =>
      query.table === 'order_items' &&
      /\bJOIN\s+(?:public\s*\.\s*)?orders\b/i.test(query.text) &&
      lockTargetsRow(query) &&
      matchesPredicates(query, [
        columnEquals('id', 'p_order_item_id'),
        columnEquals('id', 'p_order_id'),
        columnEquals('merchant_id', 'p_merchant_id'),
      ])
  );

  return { item, order };
}

export const serializedInventoryLocks = { findClaimLocks };
