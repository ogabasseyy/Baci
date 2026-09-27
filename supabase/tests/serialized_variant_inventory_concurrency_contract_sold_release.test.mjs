import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryConfirmation } from './serialized_variant_inventory_concurrency_contract_confirmation.mjs';
import { serializedInventorySoldTransition } from './serialized_variant_inventory_concurrency_contract_sold_transition.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { soldGuardDominatesUnits, soldTransitionInLockedLoop } =
  serializedInventorySoldTransition;

const soldUnitScopes = [
  /vi\s*\.\s*order_id\s*=\s*p_order_id\b/i,
  /vi\s*\.\s*merchant_id\s*=\s*p_merchant_id\b/i,
  /vi\s*\.\s*status\s*=\s*'reserved'/i,
];

function soldUnitWhereClause(sold) {
  return /FROM\s+public\s*\.\s*variant_inventory\s+vi[\s\S]*?WHERE\s+([\s\S]*?)ORDER\s+BY\s+pv\s*\.\s*product_id\s*,\s*vi\s*\.\s*id\s+FOR\s+UPDATE\s+OF\s+vi/i.exec(
    sold
  );
}

test('sale transitions serialize on the parent order before reserved units', () => {
  const sold = serializedInventoryContract.latestFunctionBody(
    'private.mark_order_inventory_units_sold(uuid, uuid)'
  );
  const orderLock =
    serializedInventoryConfirmation.findConfirmationLocks(sold).order;
  const unitSelector = soldUnitWhereClause(sold);

  assert.ok(orderLock, 'sale must lock its scoped parent order');
  assert.ok(unitSelector, 'sale must lock reserved units in stable order');
  for (const scope of soldUnitScopes) {
    assert.equal(
      serializedInventorySqlParser.isRequiredConjunct(unitSelector[1], scope),
      true,
      'sale must conjunctively scope reserved units'
    );
  }
  assert.ok(orderLock.index < unitSelector.index);
});

test('sale unit selectors reject disjunctive scope bypasses', () => {
  const sold = serializedInventoryContract.latestFunctionBody(
    'private.mark_order_inventory_units_sold(uuid, uuid)'
  );
  const bypassed = sold.replace(
    'AND vi.merchant_id = p_merchant_id\n      AND vi.status',
    'AND vi.merchant_id = p_merchant_id OR TRUE AND vi.status'
  );
  assert.notEqual(bypassed, sold);
  const unitSelector = soldUnitWhereClause(bypassed);
  assert.ok(unitSelector, 'sequence-only match still finds the selector');
  assert.equal(
    soldUnitScopes.every((scope) =>
      serializedInventorySqlParser.isRequiredConjunct(unitSelector[1], scope)
    ),
    false
  );
});

test('sale lock contract rejects an unscoped or unordered transition', () => {
  const sold = serializedInventoryContract.latestFunctionBody(
    'private.mark_order_inventory_units_sold(uuid, uuid)'
  );
  const orderLock =
    serializedInventoryConfirmation.findConfirmationLocks(sold).order;
  assert.ok(orderLock);

  const withoutOrderLock = sold.replace(
    /PERFORM\s+1\s+FROM\s+public\.orders[\s\S]*?FOR\s+UPDATE\s*;/i,
    ''
  );
  assert.equal(
    serializedInventoryConfirmation.findConfirmationLocks(withoutOrderLock)
      .order,
    undefined
  );

  const unordered = sold.replace(
    /ORDER\s+BY\s+pv\s*\.\s*product_id\s*,\s*vi\s*\.\s*id\s*/i,
    ''
  );
  assert.doesNotMatch(
    unordered,
    /ORDER\s+BY\s+pv\s*\.\s*product_id\s*,\s*vi\s*\.\s*id\s+FOR\s+UPDATE\s+OF\s+vi/i
  );
});

test('sale transitions reach sold status inside the locked-unit loop', () => {
  const sold = serializedInventoryContract.latestFunctionBody(
    'private.mark_order_inventory_units_sold(uuid, uuid)'
  );
  assert.equal(soldTransitionInLockedLoop(sold), true);

  const removed = sold.replace(
    /UPDATE\s+public\s*\.\s*variant_inventory\s+SET\s+status\s*=\s*'sold'[\s\S]*?WHERE\s+id\s*=\s*v_unit\s*\.\s*id\s+AND\s+status\s*=\s*'reserved'\s*;/i,
    'PERFORM 1;'
  );
  assert.equal(soldTransitionInLockedLoop(removed), false);

  const guarded = sold.replace(
    /UPDATE\s+public\s*\.\s*variant_inventory\s+SET\s+status\s*=\s*'sold'[\s\S]*?WHERE\s+id\s*=\s*v_unit\s*\.\s*id\s+AND\s+status\s*=\s*'reserved'\s*;/i,
    (update) => `IF false THEN\n${update}\nEND IF;`
  );
  assert.equal(soldTransitionInLockedLoop(guarded), false);
});

test('sale transitions require merchant authorization over the units', () => {
  const sold = serializedInventoryContract.latestFunctionBody(
    'private.mark_order_inventory_units_sold(uuid, uuid)'
  );
  assert.equal(soldGuardDominatesUnits(sold), true);

  const guardless = sold.replace(
    /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\.role\(\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\.has_merchant_access\s*\(\s*p_merchant_id\s*\)\s+THEN[\s\S]*?END\s+IF\s*;/i,
    ''
  );
  assert.equal(soldGuardDominatesUnits(guardless), false);
});
