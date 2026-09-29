import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryNestedQueries } from './serialized_variant_inventory_concurrency_contract_nested_queries.mjs';

test('masks nested queries without changing source offsets', () => {
  const source = 'outer (SELECT nested\nFROM fixture) tail';
  const masked = serializedInventoryNestedQueries.maskNestedQueries(source);

  assert.equal(masked.length, source.length);
  assert.equal(masked.indexOf('\n'), source.indexOf('\n'));
  assert.equal(masked.startsWith('outer '), true);
  assert.equal(masked.endsWith(' tail'), true);
  assert.doesNotMatch(masked, /SELECT|fixture/);
});
