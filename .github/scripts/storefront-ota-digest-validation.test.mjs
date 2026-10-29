import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateExportDigests } from './storefront-ota-digest-validation.mjs';

test('accepts identical file hashes regardless of key order', () => {
  assert.doesNotThrow(() => validateExportDigests({ a: 'one', b: 'two' }, { b: 'two', a: 'one' }));
});

test('rejects changed, added, deleted, and missing recorded files', () => {
  const recorded = { a: 'one', b: 'two' };
  for (const actual of [{ a: 'changed', b: 'two' }, { ...recorded, c: 'three' }, { a: 'one' }]) {
    assert.throws(() => validateExportDigests(actual, recorded), /provenance/i);
  }
  assert.throws(() => validateExportDigests(recorded, undefined), /provenance/i);
  assert.throws(() => validateExportDigests({}, undefined), /provenance/i);
  assert.throws(() => validateExportDigests({}, []), /provenance/i);
});
