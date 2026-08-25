import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const {
  isRequiredConjunct,
  maskSqlLiterals,
  splitSqlStatements,
  stripSqlComments,
} = serializedInventorySqlParser;

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
    const searchableText = maskSqlLiterals(text);
    const from =
      /FROM\s+(?:public\s*\.\s*)?(orders|order_items)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/i.exec(
        searchableText
      );
    if (!from) return [];

    const segment = searchableText.slice(from.index);
    const where = /\bWHERE\b([\s\S]*?)\bFOR\s+UPDATE\b/i.exec(segment);
    const lock = /\bFOR\s+UPDATE(?:\s+OF\s+([a-z_][a-z0-9_]*))?/i.exec(segment);
    if (
      !where ||
      !lock ||
      /\bFOR\s+UPDATE\b[\s\S]*?\b(?:SKIP\s+LOCKED|NOWAIT)\b/i.test(segment)
    ) {
      return [];
    }
    const join =
      /\bJOIN\s+(?:public\s*\.\s*)?orders(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/i.exec(
        segment
      );
    const joinOn = join
      ? /\bJOIN\s+(?:public\s*\.\s*)?orders(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+ON\s+([\s\S]*?)(?=\b(?:WHERE|JOIN|LEFT|RIGHT|FULL|INNER|CROSS|FOR)\b)/i.exec(
          segment
        )?.[1]
      : undefined;

    return [
      {
        alias: normalizeAlias(from[2]),
        index: index + from.index,
        joinAlias: normalizeAlias(join?.[1]),
        joinOn,
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
      query.joinOn !== undefined &&
      lockTargetsRow(query) &&
      isRequiredConjunct(
        query.joinOn,
        new RegExp(
          `${escapeRegex(query.alias ?? 'order_items')}\\s*\\.\\s*order_id\\s*=\\s*${escapeRegex(query.joinAlias ?? 'orders')}\\s*\\.\\s*id\\b|${escapeRegex(query.joinAlias ?? 'orders')}\\s*\\.\\s*id\\s*=\\s*${escapeRegex(query.alias ?? 'order_items')}\\s*\\.\\s*order_id\\b`,
          'i'
        )
      ) &&
      matchesPredicates(query, [
        columnEquals('id', 'p_order_item_id', query.alias ?? null),
        columnEquals('id', 'p_order_id', query.joinAlias ?? null),
        columnEquals('merchant_id', 'p_merchant_id', query.joinAlias ?? null),
      ])
  );

  return { item, order };
}

export const serializedInventoryLocks = { findClaimLocks };
