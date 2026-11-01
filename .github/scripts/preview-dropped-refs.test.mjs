import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countDroppedRefs } from './preview-dropped-refs.mjs';

test('counts each dropped reference regardless of reason', () => {
  assert.equal(countDroppedRefs({ refs: ['/ok'], skipped: [] }), 0);
  assert.equal(
    countDroppedRefs({
      refs: [],
      skipped: [{ reason: 'missing' }, { reason: 'protected-path' }],
    }),
    2
  );
});

test('fails closed when the manifest cannot establish its dropped count', () => {
  for (const invalid of [
    null,
    {},
    { refs: [], skipped: null },
    { refs: [], skipped: [null] },
    { refs: [], skipped: [{}] },
  ]) {
    assert.throws(
      () => countDroppedRefs(invalid),
      /invalid preview refs manifest/i
    );
  }
});
