import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveRemediationContainerIdentity } from './remediation-container-identity.mjs';

describe('resolveRemediationContainerIdentity', () => {
  it('returns an explicit non-root worker identity', () => {
    const result = resolveRemediationContainerIdentity({
      containerIdentity: { gid: 1002, uid: 1001 },
    });

    assert.deepEqual(result, { gid: 1002, uid: 1001 });
  });

  it(
    'falls back to the worker process identity when none is supplied',
    { skip: typeof process.getuid !== 'function' || process.getuid() === 0 },
    () => {
      const result = resolveRemediationContainerIdentity({});

      assert.deepEqual(result, {
        gid: process.getgid(),
        uid: process.getuid(),
      });
    }
  );

  it('rejects a root worker identity before Docker commands are built', () => {
    assert.throws(
      () =>
        resolveRemediationContainerIdentity({
          containerIdentity: { gid: 1001, uid: 0 },
        }),
      /requires a non-root worker uid and gid/
    );
    assert.throws(
      () =>
        resolveRemediationContainerIdentity({
          containerIdentity: { gid: 0, uid: 1001 },
        }),
      /requires a non-root worker uid and gid/
    );
  });

  it('rejects identities that are not positive integers', () => {
    assert.throws(
      () =>
        resolveRemediationContainerIdentity({
          containerIdentity: { gid: 1001, uid: '1001' },
        }),
      /requires a non-root worker uid and gid/
    );
    assert.throws(
      () => resolveRemediationContainerIdentity({ containerIdentity: {} }),
      /requires a non-root worker uid and gid/
    );
  });
});
