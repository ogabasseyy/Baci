import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventorySelectInto } from './serialized_variant_inventory_concurrency_contract_select_into.mjs';

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

const rewriteCases = [
  [
    'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)',
    'v_qty',
  ],
  ['private.confirm_order_inventory_reservations(uuid, uuid)', 'v_total_qty'],
  ['private.confirm_order_inventory_reservations(uuid, uuid)', 'v_item'],
];

function loadStatementEnd(body, variable) {
  if (variable === 'v_item') return 0;
  const load = new RegExp(
    `\\bSELECT\\b(?:(?!\\bINTO\\b)[^;])*?\\bINTO\\b[^;]*?\\b${variable}\\b[^;]*?;`,
    'i'
  ).exec(body);
  assert.ok(load);
  return load.index + load[0].length;
}

function writesVariableAfter(body, variable, fromIndex) {
  const tail = body.slice(fromIndex);
  return (
    new RegExp(
      `(?:^|[;]|\\bTHEN\\b|\\bELSE\\b|\\bLOOP\\b|\\bBEGIN\\b)\\s*${variable}\\s*(?::=|=(?!=))`,
      'i'
    ).test(tail) ||
    serializedInventorySelectInto.selectIntoWritesVariable(tail, variable)
  );
}

test('needed-unit counts survive unchanged to the available-unit selector', () => {
  for (const [functionName, assignment] of neededCases) {
    const body = serializedInventoryContract.latestFunctionBody(functionName);
    assert.doesNotMatch(
      neededWindow(body, assignment),
      /\bv_needed\s*(?::=|=(?!=))/i
    );
    assert.equal(
      serializedInventorySelectInto.selectIntoWritesVariable(
        neededWindow(body, assignment),
        'v_needed'
      ),
      false
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

    const selectInto = body.replace(
      assignment,
      (match) => `${match}\n      SELECT 0 INTO v_needed;`
    );
    assert.notEqual(selectInto, body);
    assert.equal(
      serializedInventorySelectInto.selectIntoWritesVariable(
        neededWindow(selectInto, assignment),
        'v_needed'
      ),
      true
    );
  }
});

test('reservation count inputs are never rewritten after load', () => {
  for (const [functionName, variable] of rewriteCases) {
    const body = serializedInventoryContract.latestFunctionBody(functionName);
    const fromIndex = loadStatementEnd(body, variable);
    assert.equal(writesVariableAfter(body, variable, fromIndex), false);

    const assignment =
      variable === 'v_qty'
        ? /\bv_needed\s*:=\s*v_qty\s*-\s*v_reserved_count\s*;/i
        : variable === 'v_total_qty'
          ? /SELECT\b[^;]*?\bINTO\b[^;]*?\bv_total_qty\b[^;]*?;/i
          : /\bv_needed\s*:=\s*v_item\s*\.\s*quantity\s*-\s*v_reserved_count\s*;/i;
    const overwritten = body.replace(
      assignment,
      (match) => `${match}\n      ${variable} := 0;`
    );
    assert.notEqual(overwritten, body);
    assert.equal(
      writesVariableAfter(
        overwritten,
        variable,
        loadStatementEnd(overwritten, variable)
      ),
      true
    );
  }
});
