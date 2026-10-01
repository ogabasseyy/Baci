import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createRemediationCaseStateStorage } from './remediation-case-state-storage.mjs';

describe('remediation case state storage', () => {
  it('rejects a forged global-lock capability', () => {
    assert.throws(
      () =>
        createRemediationCaseStateStorage({
          createEmptyState: () => ({ version: 1 }),
          isValidState: (state) => state?.version === 1,
          path: '/tmp/baci-forged-remediation-lock.json',
          remediationLock: {},
        }),
      /global remediation lock capability/
    );
  });

  it('removes a primary legacy lock that reappears under an external global lock', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-storage-legacy-'));
    t.after(() => rmSync(directory, { force: true, recursive: true }));
    const path = join(directory, 'state.json');
    const lockPath = `${path}.lock`;
    let lockCleanupAttempts = 0;
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      lockCapabilityValidator: () => true,
      path,
      remediationLock: {},
      unlink(target) {
        if (target === lockPath) lockCleanupAttempts += 1;
        unlinkSync(target);
      },
    });

    storage.withLock(Date.now(), null, (state) => state);
    writeFileSync(lockPath, 'legacy lock');
    storage.withLock(Date.now(), null, (state) => state);

    assert.equal(existsSync(lockPath), false);
    assert.equal(lockCleanupAttempts, 2);
  });

  it('atomically persists a validated lifecycle snapshot', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-case-storage-')),
      'state.json'
    );
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
    });

    storage.persist({ version: 1 });

    assert.deepEqual(storage.read(), { version: 1 });
    assert.equal(readFileSync(path, 'utf8'), '{\n  "version": 1\n}\n');
  });

  it('preserves the JSON parse error as the invalid-state cause', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-case-storage-parse-')),
      'state.json'
    );
    writeFileSync(path, '{not json');
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
    });

    assert.throws(
      () => storage.read(),
      (error) =>
        error.message.includes('Invalid remediation case state') &&
        error.cause instanceof SyntaxError
    );
  });

  it('removes its temporary snapshot when rename fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-storage-rename-'));
    const path = join(directory, 'state.json');
    mkdirSync(path);
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
    });

    assert.throws(() => storage.persist({ version: 1 }));
    assert.equal(existsSync(`${path}.${process.pid}.tmp`), false);
  });

  it('does not remove a lock whose ownership changes before release', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-case-storage-owner-change-')),
      'state.json'
    );
    const lockPath = `${path}.lock`;
    const replacement = {
      createdAt: '2026-08-09T10:05:00.000Z',
      pid: 42,
      token: 'replacement-owner-token',
    };
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
    });

    storage.withLock(Date.parse(replacement.createdAt), null, () => {
      unlinkSync(lockPath);
      writeFileSync(lockPath, JSON.stringify(replacement));
    });

    assert.deepEqual(JSON.parse(readFileSync(lockPath, 'utf8')), replacement);
  });

  it('preserves a replacement lock with malformed owner data without failing release', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-case-storage-malformed-owner-')),
      'state.json'
    );
    const lockPath = `${path}.lock`;
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
    });

    assert.equal(
      storage.withLock(Date.now(), null, () => {
        unlinkSync(lockPath);
        writeFileSync(lockPath, '{not json');
        return 'released';
      }),
      'released'
    );
    assert.equal(readFileSync(lockPath, 'utf8'), '{not json');
  });

  it('preserves an action error even when it has an EEXIST code', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'baci-case-storage-action-error-')),
      'state.json'
    );
    const storage = createRemediationCaseStateStorage({
      createEmptyState: () => ({ version: 1 }),
      isValidState: (state) => state?.version === 1,
      path,
    });
    const failure = Object.assign(new Error('action failed'), {
      code: 'EEXIST',
    });

    assert.throws(
      () =>
        storage.withLock(Date.now(), null, () => {
          throw failure;
        }),
      (error) => error === failure
    );
  });
});
