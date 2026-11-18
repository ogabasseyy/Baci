import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalQualificationHost } from './local-prerequisites.mjs';

test('rejects unsupported hosts before invoking any local command', () => {
  let called = false;
  assert.throws(
    () =>
      assertLocalQualificationHost({
        platform: 'linux',
        run: () => {
          called = true;
        },
      }),
    /requires macOS/
  );
  assert.equal(called, false);
});
test('reports a missing or stopped Colima prerequisite without provisioning', () => {
  assert.throws(
    () =>
      assertLocalQualificationHost({
        platform: 'darwin',
        run: () => {
          throw Error('not found');
        },
      }),
    /pre-provisioned gVisor/
  );
});
test('checks only the existing local VM status', () => {
  const calls = [];
  assertLocalQualificationHost({
    platform: 'darwin',
    run: (...args) => {
      calls.push(args);
    },
  });
  assert.deepEqual(calls[0].slice(0, 2), ['colima', ['status']]);
});
