import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createRemediationCaseStateStorage } from './remediation-case-state-storage.mjs';

const nowMs = Date.parse('2026-08-09T10:05:00.000Z');
const staleToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const createStaleLock = (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-case-storage-sidecar-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const path = join(directory, 'state.json');
  const lockPath = `${path}.lock`;
  const owner = JSON.stringify({
    createdAt: '2026-08-09T10:00:00.000Z',
    pid: 2_147_483_647,
    token: staleToken,
  });
  writeFileSync(lockPath, owner);
  writeFileSync(`${lockPath}.owner-${staleToken}`, owner);
  return { directory, lockPath, path };
};

const ownerSidecars = (directory) =>
  readdirSync(directory).filter((entry) => entry.includes('.lock.owner-'));

describe('remediation case state storage sidecar cleanup', () => {
  it('returns busy and removes its owner sidecar when the stale lock disappears before stat', (t) => {
    const { directory, lockPath, path } = createStaleLock(t);
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
      processIsAlive: () => false,
      stat(target, options) {
        if (target === lockPath) {
          unlinkSync(lockPath);
          const error = new Error('lock disappeared');
          error.code = 'ENOENT';
          throw error;
        }
        return statSync(target, options);
      },
    });

    assert.equal(
      storage.withLock(nowMs, 'busy', () => 'entered'),
      'busy'
    );
    assert.deepEqual(ownerSidecars(directory), [
      `state.json.lock.owner-${staleToken}`,
    ]);
  });

  it('returns busy and removes its owner sidecar when stale-lock reclamation fails', (t) => {
    const { directory, lockPath, path } = createStaleLock(t);
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
      processIsAlive: () => false,
      unlink(target) {
        if (target === lockPath) {
          const error = new Error('cannot reclaim lock');
          error.code = 'EACCES';
          throw error;
        }
        unlinkSync(target);
      },
    });

    assert.equal(
      storage.withLock(nowMs, 'busy', () => 'entered'),
      'busy'
    );
    assert.deepEqual(ownerSidecars(directory), [
      `state.json.lock.owner-${staleToken}`,
    ]);
  });
});
