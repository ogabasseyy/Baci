import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { isRequiredConjunct, splitSqlStatements, stripSqlComments } =
  serializedInventorySqlParser;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeAlias(alias) {
  return alias &&
    !/^(?:where|join|on|order|group|limit|for|having|union)$/i.test(alias)
    ? alias.toLowerCase()
    : undefined;
}

function columnEquals(column, value, qualifier) {
  const prefix =
    qualifier === null
      ? ''
      : qualifier
        ? `${escapeRegex(qualifier)}\\s*\\.\\s*`
        : '(?:[a-z_][a-z0-9_]*\\s*\\.\\s*)?';
  return new RegExp(`${prefix}${column}\\s*=\\s*${value}\\b`, 'i');
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
    if (
      !where ||
      !lock ||
      /\bFOR\s+UPDATE\b[\s\S]*?\bSKIP\s+LOCKED\b/i.test(segment)
    ) {
      return [];
    }
    const join =
      /\bJOIN\s+(?:public\s*\.\s*)?orders(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/i.exec(
        segment
      );

    return [
      {
        alias: normalizeAlias(from[2]),
        index: index + from.index,
        joinAlias: normalizeAlias(join?.[1]),
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
        columnEquals('id', 'p_order_id', query.alias ?? null),
        columnEquals('merchant_id', 'p_merchant_id', query.alias ?? null),
      ])
  );
  const item = queries.find(
    (query) =>
      query.table === 'order_items' &&
      /\bJOIN\s+(?:public\s*\.\s*)?orders\b/i.test(query.text) &&
      lockTargetsRow(query) &&
      matchesPredicates(query, [
        columnEquals('id', 'p_order_item_id', query.alias ?? null),
        columnEquals('id', 'p_order_id', query.joinAlias ?? null),
        columnEquals('merchant_id', 'p_merchant_id', query.joinAlias ?? null),
      ])
  );

  return { item, order };
}

export const serializedInventoryLocks = { findClaimLocks };
