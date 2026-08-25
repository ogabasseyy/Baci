import { serializedInventoryAvailability } from './serialized_variant_inventory_concurrency_contract_availability.mjs';
import { serializedInventoryNestedQueries } from './serialized_variant_inventory_concurrency_contract_nested_queries.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const {
  isRequiredConjunct,
  maskSqlLiterals,
  splitSqlStatements,
  stripSqlComments,
} = serializedInventorySqlParser;

const { maskNestedQueries } = serializedInventoryNestedQueries;

function findConfirmationLocks(source) {
  const statements = splitSqlStatements(
    maskNestedQueries(maskSqlLiterals(stripSqlComments(source)))
  );
  function find(table, predicates) {
    for (const { index, text } of statements) {
      const query = new RegExp(
        `FROM\\s+(?:public\\s*\\.\\s*)?${table}(?:\\s+(?:AS\\s+)?([a-z_][a-z0-9_]*))?[^;]*?WHERE\\s+([\\s\\S]*?)FOR\\s+UPDATE(?!\\s+(?:OF\\s+[a-z_][a-z0-9_]*\\s+)?(?:SKIP\\s+LOCKED|NOWAIT)\\b)(?:\\s+OF\\s+([a-z_][a-z0-9_]*))?(?=\\s*(?:;|LOOP\\b))`,
        'i'
      ).exec(text);
      if (
        query &&
        !/\b(?:LIMIT|OFFSET|FETCH)\b/i.test(query[2]) &&
        (!query[3] ||
          (query[1] && query[3].toLowerCase() === query[1].toLowerCase())) &&
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

function findReclaimReservationTransition(source) {
  const selector =
    serializedInventoryAvailability.availableUnitWhereClause(source);
  if (!selector) return undefined;
  const cleanSource = maskSqlLiterals(stripSqlComments(source), {
    preserveStrings: true,
  });
  const remainder = cleanSource.slice(selector.index);
  const counter =
    /\bv_reclaimed_count\s*:=\s*v_reclaimed_count\s*\+\s*1\b/i.exec(remainder);
  if (!counter) return undefined;
  const beforeCounter = remainder.slice(0, counter.index);
  const updates = [
    ...beforeCounter.matchAll(
      /UPDATE\s+(?:public\s*\.\s*)?variant_inventory(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*?);/gi
    ),
  ];
  const transition = updates.find(
    (update) =>
      /\bstatus\s*=\s*'reserved'/i.test(update[1]) &&
      /\border_id\s*=\s*p_order_id\b/i.test(update[1]) &&
      /\border_item_id\s*=\s*v_item\s*\.\s*id\b/i.test(update[1]) &&
      isRequiredConjunct(update[2], /\bid\s*=\s*v_unit\s*\.\s*id\b/i)
  );
  if (!transition) return undefined;
  return { index: selector.index + transition.index };
}

function confirmationLocksPrecedeReclaim(source) {
  const locks = findConfirmationLocks(source);
  const selector =
    serializedInventoryAvailability.availableUnitWhereClause(source);
  return Boolean(
    locks.order &&
      locks.item &&
      selector &&
      locks.order.index < selector.index &&
      locks.item.index < selector.index
  );
}

export const serializedInventoryConfirmation = {
  confirmationLocksPrecedeReclaim,
  findConfirmationLocks,
  findReclaimReservationTransition,
};
