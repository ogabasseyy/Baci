import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryConfirmation } from './serialized_variant_inventory_concurrency_contract_confirmation.mjs';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';

const { latestFunctionBody } = serializedInventoryContract;
const { findConfirmationLocks } = serializedInventoryConfirmation;
const { dominatesControlFlow, isReachable } = serializedInventoryControlFlow;

const confirmationHoldGuard =
  /IF\s+NOT\s+v_is_confirmed_hold\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?RAISE\s+EXCEPTION\s+['"]order_not_confirmed_for_inventory_hold['"](?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i;
const fullyReservedExpiryClear =
  /IF\s+v_reserved_count\s*=\s*v_item\.quantity\s+THEN[\s\S]*?UPDATE\s+public\.variant_inventory\s+SET\s+reservation_expires_at\s*=\s*NULL[\s\S]*?WHERE\s+order_item_id\s*=\s*v_item\.id\s+AND\s+reservation_expires_at\s+IS\s+NOT\s+NULL\s*;/i;
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
  const guard = confirmationHoldGuard.exec(confirm);
  const locks = findConfirmationLocks(confirm);
  assert.ok(guard);
  assert.ok(locks.item);
  assert.equal(isReachable(confirm, guard.index), true);
  assert.equal(
    dominatesControlFlow(confirm, guard.index, locks.item.index),
    true
  );

  const unreachable = confirm.replace(
    confirmationHoldGuard,
    (match) => `IF false THEN\n${match}\nEND IF;`
  );
  const unreachableGuard = confirmationHoldGuard.exec(unreachable);
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
