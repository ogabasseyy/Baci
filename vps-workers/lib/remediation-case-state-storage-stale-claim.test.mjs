import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { createRemediationCaseStateStorage } from './remediation-case-state-storage.mjs';

it('serializes stale lock reclamation so only one contender enters its action', (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), 'baci-case-storage-stale-claim-')
  );
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const path = join(directory, 'state.json');
  const lockPath = `${path}.lock`;
  const nowMs = Date.parse('2026-08-09T10:05:00.000Z');
  const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const staleOwner = JSON.stringify({
    createdAt: '2026-08-09T10:00:00.000Z',
    pid: 2_147_483_647,
    token,
  });
  writeFileSync(lockPath, staleOwner);
  writeFileSync(`${lockPath}.owner-${token}`, staleOwner);
  let firstActions = 0;
  let secondActions = 0;
  const first = createRemediationCaseStateStorage({
    createEmptyState: () => ({ version: 1 }),
    isValidState: (state) => state?.version === 1,
    path,
    processIsAlive: () => false,
  });
  let interleaved = false;
  const second = createRemediationCaseStateStorage({
    createEmptyState: () => ({ version: 1 }),
    isValidState: (state) => state?.version === 1,
    path,
    processIsAlive: () => false,
    unlink(target) {
      if (target !== lockPath || interleaved) {
        unlinkSync(target);
        return;
      }
      interleaved = true;
      first.withLock(nowMs, 'busy', () => {
        firstActions += 1;
        unlinkSync(lockPath);
        return 'first';
      });
      if (!firstActions) unlinkSync(lockPath);
    },
  });

  assert.equal(
    second.withLock(nowMs, null, () => {
      secondActions += 1;
      return 'second';
    }),
    'second'
  );
  assert.deepEqual([firstActions, secondActions], [0, 1]);
});
