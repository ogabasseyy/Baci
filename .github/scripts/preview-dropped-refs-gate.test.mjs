import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runDroppedRefsGate } from './preview-dropped-refs-gate.mjs';

test('skips network activity when no references were dropped', async () => {
  const result = await runDroppedRefsGate({
    manifest: { refs: [], skipped: [] },
    inspect: async () => {
      throw new Error('unexpected');
    },
    smoke: async () => {
      throw new Error('unexpected');
    },
  });
  assert.equal(result, 'skipped');
});

test('requires READY and a passing served smoke verdict when references were dropped', async () => {
  const manifest = { refs: [], skipped: [{ reason: 'missing' }] };
  const calls = [];
  assert.equal(
    await runDroppedRefsGate({
      manifest,
      inspect: async () => {
        calls.push('inspect');
        return 'READY';
      },
      smoke: async () => {
        calls.push('smoke');
      },
    }),
    'passed'
  );
  assert.deepEqual(calls, ['inspect', 'smoke']);
  await assert.rejects(
    runDroppedRefsGate({
      manifest,
      inspect: async () => 'ERROR',
      smoke: async () => {
        throw new Error('unexpected');
      },
    }),
    /ready/i
  );
  await assert.rejects(
    runDroppedRefsGate({
      manifest,
      inspect: async () => 'READY',
      smoke: async () => {
        throw new Error('broken');
      },
    }),
    /broken/i
  );
});
