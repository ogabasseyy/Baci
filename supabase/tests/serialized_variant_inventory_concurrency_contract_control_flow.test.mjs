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

test('closes SQL CASE expressions before later control-flow checks', () => {
  const source =
    'IF false THEN\nUPDATE x SET value = CASE WHEN ready THEN 1 ELSE 0 END;\nEND IF;\ncounter;';
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      source,
      source.indexOf('UPDATE'),
      source.indexOf('counter')
    ),
    false
  );
});

test('does not let zero-iteration loops dominate later statements', () => {
  const source = 'WHILE false LOOP\nlock_row;\nEND LOOP;\nselector;';
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      source,
      source.indexOf('lock_row'),
      source.indexOf('selector')
    ),
    false
  );
});

test('marks FOR queries with an unconditional false filter unreachable', () => {
  const source =
    'FOR v_unit IN SELECT NULL WHERE false LOOP\nraise_exception;\nEND LOOP;\nafter;';
  assert.equal(
    serializedInventoryControlFlow.isReachable(
      source,
      source.indexOf('raise_exception')
    ),
    false
  );
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      source,
      source.indexOf('raise_exception'),
      source.indexOf('after')
    ),
    false
  );
});

test('rejects protected operations after an unconditional early return', () => {
  const source = 'RETURN success;\nauthorize;\nlock_row;';
  assert.equal(
    serializedInventoryControlFlow.dominatesControlFlow(
      source,
      source.indexOf('authorize'),
      source.indexOf('lock_row')
    ),
    false
  );
});

test('rejects prerequisites hidden in a constant-false branch', () => {
  for (const condition of [
    'false',
    '(false)',
    'false::boolean',
    'false /* unreachable */',
    'NOT true',
  ]) {
    const source = `IF ${condition} THEN\nauthorize;\nEND IF;\nlock_row;`;
    assert.equal(
      serializedInventoryControlFlow.dominatesControlFlow(
        source,
        source.indexOf('authorize'),
        source.indexOf('lock_row')
      ),
      false
    );
  }
});
