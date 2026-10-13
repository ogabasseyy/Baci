import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createRemediationCaseStateStorage } from './remediation-case-state-storage.mjs';

const createStatePath = (t, prefix) => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return join(directory, 'state.json');
};

describe('remediation case state storage lock recovery', () => {
  it('retries after a stale lock disappears during concurrent cleanup', (t) => {
    const path = createStatePath(t, 'baci-case-storage-stale-');
    const lockPath = `${path}.lock`;
    writeFileSync(
      lockPath,
      JSON.stringify({
        createdAt: '2026-08-09T10:00:00.000Z',
        pid: 2_147_483_647,
        token: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      })
    );
    const staleAt = Date.now() - 3 * 60 * 1_000;
    utimesSync(lockPath, staleAt / 1_000, staleAt / 1_000);
    let staleUnlink = true;
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
      processIsAlive: () => false,
      unlink(target) {
        if (target === lockPath && staleUnlink) {
          staleUnlink = false;
          unlinkSync(target);
          const error = new Error('already removed');
          error.code = 'ENOENT';
          throw error;
        }
        unlinkSync(target);
      },
    });

    assert.deepEqual(
      storage.withLock(Date.now(), null, (state) => state),
      {
        version: 1,
      }
    );
  });

  it('recovers an aged empty lock when a worker crashes after opening it', (t) => {
    const path = createStatePath(t, 'baci-case-storage-ownerless-');
    const lockPath = `${path}.lock`;
    const nowMs = Date.parse('2026-08-09T10:05:00.000Z');
    writeFileSync(lockPath, '');
    const staleAt = nowMs - 3 * 60 * 1_000;
    utimesSync(lockPath, staleAt / 1_000, staleAt / 1_000);
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
    });

    assert.deepEqual(
      storage.withLock(nowMs, null, (state) => state),
      {
        version: 1,
      }
    );
    assert.equal(existsSync(lockPath), false);
  });

  it('keeps a recent partial lock busy while its owner metadata may still be written', (t) => {
    const path = createStatePath(t, 'baci-case-storage-partial-lock-');
    const lockPath = `${path}.lock`;
    const nowMs = Date.parse('2026-08-09T10:05:00.000Z');
    writeFileSync(lockPath, '{"createdAt":');
    utimesSync(lockPath, nowMs / 1_000, nowMs / 1_000);
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
    });

    assert.equal(
      storage.withLock(nowMs, 'busy', (state) => state),
      'busy'
    );
    assert.equal(readFileSync(lockPath, 'utf8'), '{"createdAt":');
  });

  it('recovers an aged partial lock with no usable owner identity', (t) => {
    const path = createStatePath(t, 'baci-case-storage-partial-ownerless-');
    const lockPath = `${path}.lock`;
    const nowMs = Date.parse('2026-08-09T10:05:00.000Z');
    writeFileSync(
      lockPath,
      JSON.stringify({
        createdAt: '2026-08-09T10:00:00.000Z',
      })
    );
    const staleAt = nowMs - 3 * 60 * 1_000;
    utimesSync(lockPath, staleAt / 1_000, staleAt / 1_000);
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
    });

    assert.deepEqual(
      storage.withLock(nowMs, null, (state) => state),
      {
        version: 1,
      }
    );
  });

  it('keeps a replacement partial lock after an ownerless stale snapshot', (t) => {
    const path = createStatePath(t, 'baci-case-storage-ownerless-replacement-');
    const lockPath = `${path}.lock`;
    const nowMs = Date.parse('2026-08-09T10:05:00.000Z');
    const staleAt = nowMs - 3 * 60 * 1_000;
    writeFileSync(lockPath, '');
    utimesSync(lockPath, staleAt / 1_000, staleAt / 1_000);
    let replaced = false;
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
      stat(target, options) {
        const metadata = statSync(target, options);
        if (target === lockPath && !replaced) {
          replaced = true;
          writeFileSync(lockPath, '{partial replacement');
          utimesSync(lockPath, nowMs / 1_000, nowMs / 1_000);
        }
        return metadata;
      },
    });

    assert.equal(
      storage.withLock(nowMs, 'busy', () => 'entered'),
      'busy'
    );
    assert.equal(replaced, true);
    assert.equal(readFileSync(lockPath, 'utf8'), '{partial replacement');
  });

  it('keeps an aged live lock when process start time cannot be read', (t) => {
    const path = createStatePath(t, 'baci-case-storage-live-owner-');
    const lockPath = `${path}.lock`;
    const nowMs = Date.parse('2026-08-09T10:05:00.000Z');
    writeFileSync(
      lockPath,
      JSON.stringify({
        createdAt: '2026-08-09T10:00:00.000Z',
        pid: 42,
        processStartedAt: 'live-process',
        token: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      })
    );
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
      processIsAlive: () => true,
      processStartedAt: () => null,
    });

    assert.equal(
      storage.withLock(nowMs, 'busy', (state) => state),
      'busy'
    );
    assert.equal(existsSync(lockPath), true);
  });

  it('reclaims a stale case-state lock after its PID has been reused', (t) => {
    const path = createStatePath(t, 'baci-case-storage-pid-reuse-');
    const token = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    writeFileSync(
      `${path}.lock`,
      JSON.stringify({
        createdAt: '2026-08-09T10:00:00.000Z',
        pid: 42,
        processStartedAt: 'original-process',
        token,
      })
    );
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
      processIsAlive: () => true,
      processStartedAt: () => 'reused-process',
    });

    assert.deepEqual(
      storage.withLock(
        Date.parse('2026-08-09T10:05:00.000Z'),
        null,
        (state) => state
      ),
      { version: 1 }
    );
  });
});
