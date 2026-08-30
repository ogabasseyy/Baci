import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryConfirmation } from './serialized_variant_inventory_concurrency_contract_confirmation.mjs';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';

test('sale transitions serialize on the parent order before reserved units', () => {
  const sold = serializedInventoryContract.latestFunctionBody(
    'private.mark_order_inventory_units_sold(uuid, uuid)'
  );
  const orderLock = serializedInventoryConfirmation.findConfirmationLocks(sold).order;
  const unitSelector =
    /FROM\s+public\s*\.\s*variant_inventory\s+vi[\s\S]*?WHERE\s+vi\s*\.\s*order_id\s*=\s*p_order_id[\s\S]*?vi\s*\.\s*merchant_id\s*=\s*p_merchant_id[\s\S]*?vi\s*\.\s*status\s*=\s*'reserved'[\s\S]*?ORDER\s+BY\s+pv\s*\.\s*product_id\s*,\s*vi\s*\.\s*id\s+FOR\s+UPDATE\s+OF\s+vi/i.exec(
      sold
    );

  assert.ok(orderLock, 'sale must lock its scoped parent order');
  assert.ok(unitSelector, 'sale must lock reserved units in stable order');
  assert.ok(orderLock.index < unitSelector.index);
});

test('sale lock contract rejects an unscoped or unordered transition', () => {
  const sold = serializedInventoryContract.latestFunctionBody(
    'private.mark_order_inventory_units_sold(uuid, uuid)'
  );
  const orderLock = serializedInventoryConfirmation.findConfirmationLocks(sold).order;
  assert.ok(orderLock);

  const withoutOrderLock = sold.replace(
    /PERFORM\s+1\s+FROM\s+public\.orders[\s\S]*?FOR\s+UPDATE\s*;/i,
    ''
  );
  assert.equal(
    serializedInventoryConfirmation.findConfirmationLocks(withoutOrderLock).order,
    undefined
  );

  const unordered = sold.replace(
    /ORDER\s+BY\s+pv\s*\.\s*product_id\s*,\s*vi\s*\.\s*id\s*/i,
    ''
  );
  assert.doesNotMatch(unordered, /ORDER\s+BY\s+pv\s*\.\s*product_id\s*,\s*vi\s*\.\s*id\s+FOR\s+UPDATE\s+OF\s+vi/i);
});
