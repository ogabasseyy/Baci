import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryDecrementGuards } from './serialized_variant_inventory_concurrency_contract_decrement_guards.mjs';

const decrementFunctions = [
  'public.decrement_product_stock(uuid, integer)',
  'public.decrement_variant_stock(uuid, integer)',
];

test('unlimited-stock exits require a top-level bare return', () => {
  for (const functionName of decrementFunctions) {
    const body = serializedInventoryContract.latestFunctionBody(functionName);
    const arm =
      /IF\s+NOT\s+COALESCE\s*\(\s*v_manage_stock[\s\S]*?END\s+IF\s*;/i.exec(
        body
      )[0];
    assert.equal(
      serializedInventoryDecrementGuards.hasUnlimitedStockReturn(
        body.replace(
          arm,
          arm.replace(/\bRETURN\s*;/i, 'IF false THEN\n  RETURN;\nEND IF;')
        )
      ),
      false
    );
  }
});

test('missing-resource branches authorize without message matching', () => {
  for (const functionName of decrementFunctions) {
    const body = serializedInventoryContract.latestFunctionBody(functionName);
    assert.equal(
      serializedInventoryDecrementGuards.missingResourceResponsesRequireServiceRole(
        body
      ),
      true
    );
    const reworded = body.replace(
      /IF\s+NOT\s+FOUND\s+THEN\s+IF\s*\(\s*SELECT\s+auth\.role\(\)\s*\)\s+IS\s+DISTINCT\s+FROM\s+'service_role'\s+THEN[\s\S]*?END\s+IF;\s+/i,
      'IF NOT FOUND THEN\n    '
    );
    assert.notEqual(reworded, body);
    assert.equal(
      serializedInventoryDecrementGuards.missingResourceResponsesRequireServiceRole(
        reworded.replace(/'(?:Product|Variant) not found'/g, "'Missing'")
      ),
      false
    );
  }
});
