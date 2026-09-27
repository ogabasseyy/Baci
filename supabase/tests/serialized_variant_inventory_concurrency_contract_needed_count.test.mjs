import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';

const neededCases = [
  [
    'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)',
    /\bv_needed\s*:=\s*v_qty\s*-\s*v_reserved_count\s*;/i,
  ],
  [
    'private.confirm_order_inventory_reservations(uuid, uuid)',
    /\bv_needed\s*:=\s*v_item\s*\.\s*quantity\s*-\s*v_reserved_count\s*;/i,
  ],
];

function neededWindow(body, assignment) {
  const needed = assignment.exec(body);
  const selector = /\bLIMIT\s+v_needed\b/i.exec(body);
  assert.ok(needed);
  assert.ok(selector);
  return body.slice(needed.index + needed[0].length, selector.index);
}

test('needed-unit counts survive unchanged to the available-unit selector', () => {
  for (const [functionName, assignment] of neededCases) {
    const body = serializedInventoryContract.latestFunctionBody(functionName);
    assert.doesNotMatch(
      neededWindow(body, assignment),
      /\bv_needed\s*(?::=|=(?!=))/i
    );

    const overwritten = body.replace(
      assignment,
      (match) => `${match}\n      v_needed := 0;`
    );
    assert.notEqual(overwritten, body);
    assert.match(
      neededWindow(overwritten, assignment),
      /\bv_needed\s*(?::=|=(?!=))/i
    );
  }
});
