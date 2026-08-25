import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryControlFlow } from './serialized_variant_inventory_concurrency_contract_control_flow.mjs';

test('distinguishes statements in conditional and sibling branches', () => {
  const source =
    'IF enabled THEN\nlock_row;\nELSE\nother_row;\nEND IF;\nafter_row;';
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      source,
      source.indexOf('lock_row'),
      source.indexOf('after_row')
    ),
    false
  );
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      source,
      source.indexOf('lock_row'),
      source.indexOf('other_row')
    ),
    false
  );
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      source,
      source.indexOf('IF enabled'),
      source.indexOf('lock_row')
    ),
    true
  );
});
