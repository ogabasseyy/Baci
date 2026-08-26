import { serializedInventoryAvailability } from './serialized_variant_inventory_concurrency_contract_availability.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
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
        return {
          end: index + text.length,
          index: index + query.index,
          where: query[2],
        };
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

function orderLockFailsClosed(source) {
  const cleanSource = maskSqlLiterals(stripSqlComments(source), {
    preserveStrings: true,
  });
  const orderLock = findConfirmationLocks(cleanSource).order;
  return Boolean(
    orderLock &&
      /^\s*IF\s+NOT\s+FOUND\s+THEN\s+RAISE\s+EXCEPTION\s+['"]order_not_found['"][^;]*;\s*END\s+IF\s*;/i.test(
        cleanSource.slice(orderLock.end)
      )
  );
}

function findReclaimReservationTransition(source) {
  const cleanSource = maskSqlLiterals(stripSqlComments(source), {
    preserveStrings: true,
  });
  const selector = serializedInventoryAvailability.availableUnitWhereClause(
    cleanSource,
    true
  );
  if (!selector) return undefined;
  const remainder = cleanSource.slice(selector.index);
  const counters = [
    ...remainder.matchAll(
      /\bv_reclaimed_count\s*:=\s*v_reclaimed_count\s*\+\s*1\b/gi
    ),
  ];
  const claimedCounters = [
    ...remainder.matchAll(
      /\bv_claimed_in_loop\s*:=\s*v_claimed_in_loop\s*\+\s*1\b/gi
    ),
  ];
  if (counters.length !== 1 || claimedCounters.length !== 1) return undefined;
  const [counter] = counters;
  const [claimedCounter] = claimedCounters;
  const beforeCounter = remainder.slice(0, counter.index);
  const updates = [
    ...beforeCounter.matchAll(
      /UPDATE\s+(?:public\s*\.\s*)?variant_inventory(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*?);/gi
    ),
  ];
  const transition = updates.find(
    (update) =>
      !/\b(?:IF|CASE)\b/i.test(
        beforeCounter
          .slice(0, update.index)
          .split(/\bLOOP\b/i)
          .at(-1) ?? ''
      ) &&
      /\bstatus\s*=\s*'reserved'/i.test(update[1]) &&
      /\border_id\s*=\s*p_order_id\b/i.test(update[1]) &&
      /\border_item_id\s*=\s*v_item\s*\.\s*id\b/i.test(update[1]) &&
      /^(?:\s*\(\s*)*(?:(?:[a-z_][a-z0-9_]*)\s*\.\s*)?id\s*=\s*v_unit\s*\.\s*id(?:\s*\)\s*)*$/i.test(
        update[2]
      )
  );
  if (!transition) return undefined;
  const transitionIndex = selector.index + transition.index;
  const claimedCounterIndex = selector.index + claimedCounter.index;
  if (
    !serializedInventoryControlFlow.sharesInnermostLoop(
      cleanSource,
      selector.index,
      transitionIndex,
      claimedCounterIndex
    ) ||
    !serializedInventoryControlFlow.dominatesControlFlow(
      cleanSource,
      transitionIndex,
      claimedCounterIndex
    )
  ) {
    return undefined;
  }
  return { index: transitionIndex };
}

function confirmationLocksPrecedeReclaim(source) {
  const locks = findConfirmationLocks(source);
  const selector =
    serializedInventoryAvailability.availableUnitWhereClause(source);
  return Boolean(
    locks.order &&
      locks.item &&
      selector &&
      serializedInventoryControlFlow.dominatesControlFlow(
        source,
        locks.order.index,
        selector.index
      ) &&
      serializedInventoryControlFlow.dominatesControlFlow(
        source,
        locks.item.index,
        selector.index
      ) &&
      locks.order.index < selector.index &&
      locks.item.index < selector.index
  );
}

export const serializedInventoryConfirmation = {
  confirmationLocksPrecedeReclaim,
  findConfirmationLocks,
  findReclaimReservationTransition,
  orderLockFailsClosed,
};
