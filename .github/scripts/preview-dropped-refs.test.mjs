import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countDroppedRefs } from './preview-dropped-refs.mjs';

test('counts dropped references while excluding values retained in the map', () => {
  assert.equal(countDroppedRefs({ refs: ['/ok'], skipped: [] }), 0);
  assert.equal(
    countDroppedRefs({
      refs: [],
      skipped: [{ reason: 'missing' }, { reason: 'protected-path' }],
    }),
    2
  );
  assert.equal(
    countDroppedRefs({
      refs: [],
      skipped: [
        { reason: 'inside-output' },
        { reason: 'absolute' },
        { reason: 'escapes-root' },
      ],
    }),
    0
  );
  assert.throws(
    () => countDroppedRefs({ refs: [], skipped: [{ reason: 'unrecognized' }] }),
    /invalid preview refs manifest/i
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
