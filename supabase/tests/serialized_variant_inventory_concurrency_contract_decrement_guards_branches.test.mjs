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

test('validated decrement quantities reject post-guard reassignment', () => {
  for (const functionName of decrementFunctions) {
    const body = serializedInventoryContract.latestFunctionBody(functionName);
    assert.equal(
      serializedInventoryDecrementGuards.hasPositiveQuantityGuard(body),
      true
    );
    const guard =
      /IF\s+quantity_param\s+IS\s+NULL\s+OR\s+quantity_param\s*<=\s*0\s+THEN[\s\S]*?END\s+IF\s*;/i.exec(
        body
      );
    assert.ok(guard);
    const reassigned = body.replace(
      guard[0],
      `${guard[0]}\n  quantity_param := -1;`
    );
    assert.equal(
      serializedInventoryDecrementGuards.hasPositiveQuantityGuard(reassigned),
      false
    );
  }
});

test('authorized decrement targets reject post-guard reassignment', () => {
  for (const functionName of decrementFunctions) {
    const body = serializedInventoryContract.latestFunctionBody(functionName);
    assert.equal(
      serializedInventoryDecrementGuards.hasMerchantAuthorizationGuard(body),
      true
    );
    const guard =
      /IF\s+COALESCE\s*\(\s*\(\s*SELECT\s+auth\s*\.\s*role\s*\(\s*\)\s*\)\s*,\s*''\s*\)\s*<>\s*'service_role'\s+AND\s+NOT\s+public\s*\.\s*has_merchant_access\s*\(\s*v_merchant_id\s*\)\s+THEN[\s\S]*?END\s+IF\s*;/i.exec(
        body
      );
    assert.ok(guard);
    const target = functionName.includes('variant_stock')
      ? 'variant_id_param'
      : 'product_id_param';
    const reassigned = body.replace(
      guard[0],
      `${guard[0]}\n  ${target} := NULL;`
    );
    assert.notEqual(reassigned, body);
    assert.equal(
      serializedInventoryDecrementGuards.hasMerchantAuthorizationGuard(
        reassigned
      ),
      false
    );
  }
});
