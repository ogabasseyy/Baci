import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventoryConfirmation } from './serialized_variant_inventory_concurrency_contract_confirmation.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { latestFunctionBody } = serializedInventoryContract;
const {
  confirmationItemOrderIsDeterministic,
  findConfirmationLocks,
  findReclaimReservationTransition,
  reclaimCounterResetPerItem,
} = serializedInventoryConfirmation;
const { dominatesControlFlow, isReachable } = serializedInventoryControlFlow;

const holdGuardOpening = /IF\s+NOT\s+v_is_confirmed_hold\s+THEN\b/i;

function holdRejectionRaisesAtTopLevel(source) {
  let arms;
  try {
    arms = serializedInventoryBranches.extractIfArms(source, holdGuardOpening);
  } catch {
    return false;
  }
  const masked = serializedInventorySqlParser.maskSqlLiterals(arms.thenBranch);
  let topLevelRaise = false;
  let depth = 0;
  let caseDepth = 0;
  for (const token of masked.matchAll(
    /\bEND\s+IF\b|\bEND\s+CASE\b|\bEND\b(?!\s+(?:IF|CASE|LOOP)\b)|\bIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bCASE\b|\bRAISE\s+EXCEPTION\b/gi
  )) {
    if (/^END\s+IF/i.test(token[0])) depth = Math.max(0, depth - 1);
    else if (/^END\s+CASE/i.test(token[0]))
      caseDepth = Math.max(0, caseDepth - 1);
    else if (/^END\b/i.test(token[0])) caseDepth = Math.max(0, caseDepth - 1);
    else if (/^IF\b/i.test(token[0])) depth += 1;
    else if (/^CASE$/i.test(token[0])) caseDepth += 1;
    else if (depth === 0 && caseDepth === 0) topLevelRaise = true;
  }
  return (
    topLevelRaise &&
    /RAISE\s+EXCEPTION\s+['"]order_not_confirmed_for_inventory_hold['"]/i.test(
      arms.thenBranch
    )
  );
}
const fullyReservedExpiryClear =
  /IF\s+v_reserved_count\s*=\s*v_item\.quantity\s+THEN[\s\S]*?WITH\s+confirmed_units\s+AS\s*\(\s*UPDATE\s+public\.variant_inventory\s+SET\s+reservation_expires_at\s*=\s*NULL[\s\S]*?WHERE\s+order_item_id\s*=\s*v_item\.id\s+AND\s+status\s*=\s*'reserved'\s+AND\s+reservation_expires_at\s+IS\s+NOT\s+NULL\s+RETURNING\s+id\s*\)\s*SELECT[\s\S]*?FROM\s+confirmed_units\s*;/i;
const partialExpiryClear =
  /ELSE[\s\S]*?UPDATE\s+public\.variant_inventory\s+SET\s+reservation_expires_at\s*=\s*NULL[\s\S]*?WHERE\s+order_item_id\s*=\s*v_item\.id\s*;/i;

function matchedUpdate(pattern, source) {
  const match = pattern.exec(source);
  assert.ok(match);
  const offset = match[0].indexOf('UPDATE');
  assert.notEqual(offset, -1);
  return { text: match[0].slice(offset), index: match.index + offset };
}

test('confirmation rejection remains reachable before item reconciliation', () => {
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  const guard = holdGuardOpening.exec(confirm);
  const locks = findConfirmationLocks(confirm);
  assert.ok(guard);
  assert.equal(holdRejectionRaisesAtTopLevel(confirm), true);
  assert.ok(locks.item);
  assert.equal(isReachable(confirm, guard.index), true);
  assert.equal(
    dominatesControlFlow(confirm, guard.index, locks.item.index),
    true
  );

  const guardBlock = confirm.slice(
    guard.index,
    confirm.indexOf('END IF;', guard.index) + 'END IF;'.length
  );
  const unreachable = confirm.replace(
    guardBlock,
    (match) => `IF false THEN\n${match}\nEND IF;`
  );
  const unreachableGuard = holdGuardOpening.exec(unreachable);
  const unreachableLocks = findConfirmationLocks(unreachable);
  assert.ok(unreachableGuard);
  assert.ok(unreachableLocks.item);
  assert.equal(
    dominatesControlFlow(
      unreachable,
      unreachableGuard.index,
      unreachableLocks.item.index
    ),
    false
  );

  const nestedRaise = confirm.replace(
    /RAISE\s+EXCEPTION\s+['"]order_not_confirmed_for_inventory_hold['"][^;]*;/i,
    (raise) => `IF false THEN\n${raise}\nEND IF;`
  );
  assert.equal(holdRejectionRaisesAtTopLevel(nestedRaise), false);
});

test('reservation expiry clears remain reachable in both reconciliation branches', () => {
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  const updates = [
    matchedUpdate(fullyReservedExpiryClear, confirm),
    matchedUpdate(partialExpiryClear, confirm),
  ];
  for (const update of updates) {
    assert.equal(isReachable(confirm, update.index), true);
    const wrappedUpdate = `IF false THEN\n${update.text}\nEND IF;`;
    const unreachable = confirm.replace(update.text, wrappedUpdate);
    const unreachableIndex =
      unreachable.indexOf(wrappedUpdate) + wrappedUpdate.indexOf('UPDATE');
    assert.notEqual(unreachableIndex, -1);
    assert.equal(isReachable(unreachable, unreachableIndex), false);
  }
});

test('reclaim counters stay per-item and reachable', () => {
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  assert.equal(reclaimCounterResetPerItem(confirm), true);

  const reset = /v_claimed_in_loop\s*:=\s*0\s*;/i.exec(confirm);
  const itemLoop = /FOR\s+v_item\s+IN\b/i.exec(confirm);
  assert.ok(reset);
  assert.ok(itemLoop);
  const movedReset = confirm
    .replace(reset[0], '')
    .replace(itemLoop[0], `${reset[0]}\n${itemLoop[0]}`);
  assert.equal(reclaimCounterResetPerItem(movedReset), false);

  const reclaimedIncrement =
    /v_reclaimed_count\s*:=\s*v_reclaimed_count\s*\+\s*1\s*;/i.exec(confirm);
  assert.ok(reclaimedIncrement);
  const unreachableIncrement = confirm.replace(
    reclaimedIncrement[0],
    `IF false THEN\n${reclaimedIncrement[0]}\nEND IF;`
  );
  assert.equal(
    findReclaimReservationTransition(unreachableIncrement),
    undefined
  );
});

test('confirmation item locks require ascending product/id order', () => {
  const ordered = `
    SELECT oi.id FROM order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.product_id, oi.id
    FOR UPDATE;
  `;
  const descending = ordered.replace(
    'ORDER BY oi.product_id, oi.id',
    'ORDER BY oi.product_id DESC, oi.id DESC'
  );

  assert.equal(
    confirmationItemOrderIsDeterministic(findConfirmationLocks(ordered).item),
    true
  );
  assert.ok(findConfirmationLocks(descending).item);
  assert.equal(
    confirmationItemOrderIsDeterministic(
      findConfirmationLocks(descending).item
    ),
    false
  );
});

test('confirmation item locks reject narrowing predicates', () => {
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  assert.ok(findConfirmationLocks(confirm).item);

  const narrowed = confirm.replace(
    'WHERE oi.order_id = p_order_id',
    'WHERE oi.order_id = p_order_id AND oi.quantity > 1'
  );
  assert.equal(findConfirmationLocks(narrowed).item, undefined);
});

test('confirmation order locks reject narrowing predicates', () => {
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  assert.ok(findConfirmationLocks(confirm).order);

  const narrowed = confirm.replace(
    /FROM\s+public\.orders\s+WHERE\s+id\s*=\s*p_order_id\s+AND\s+merchant_id\s*=\s*p_merchant_id/i,
    (lock) => `${lock} AND payment_status = 'paid'`
  );
  assert.notEqual(narrowed, confirm);
  assert.equal(findConfirmationLocks(narrowed).order, undefined);
});

test('constant-true early exits terminate downstream control flow', () => {
  const source = `
    PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF true THEN RETURN '{}'::jsonb; END IF;
    UPDATE public.variant_inventory SET status = 'reserved' WHERE id = v_unit.id;
  `;
  const lock = /FOR\s+UPDATE/i.exec(source);
  const update = /UPDATE\s+public\.variant_inventory/i.exec(source);
  assert.ok(lock);
  assert.ok(update);
  assert.equal(isReachable(source, lock.index), true);
  assert.equal(isReachable(source, update.index), false);
  assert.equal(dominatesControlFlow(source, lock.index, update.index), false);

  const conditional = source.replace('IF true THEN', 'IF v_skip THEN');
  const liveUpdate = /UPDATE\s+public\.variant_inventory/i.exec(conditional);
  assert.ok(liveUpdate);
  assert.equal(isReachable(conditional, liveUpdate.index), true);
});

test('confirmation claim counters reject resets after the increment', () => {
  const confirm = latestFunctionBody(
    'private.confirm_order_inventory_reservations(uuid, uuid)'
  );
  assert.equal(reclaimCounterResetPerItem(confirm), true);

  const increment =
    /v_claimed_in_loop\s*:=\s*v_claimed_in_loop\s*\+\s*1\s*;/i.exec(confirm);
  assert.ok(increment);
  const reset = confirm.replace(
    increment[0],
    `${increment[0]}\n      v_claimed_in_loop := 0;`
  );
  assert.notEqual(reset, confirm);
  assert.equal(reclaimCounterResetPerItem(reset), false);
});
