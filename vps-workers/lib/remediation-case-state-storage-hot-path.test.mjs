import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { createRemediationCaseStateStorage } from './remediation-case-state-storage.mjs';

it('captures the local process start marker before lock acquisitions', () => {
  let startedAtCalls = 0;
  const storage = createRemediationCaseStateStorage({
    createEmptyState: () => ({ version: 1 }),
    isValidState: (state) => state?.version === 1,
    path: join(
      mkdtempSync(join(tmpdir(), 'baci-case-storage-hot-path-')),
      'state.json'
    ),
    processStartedAt: () => {
      startedAtCalls += 1;
      return 'local-process';
    },
  });

  assert.equal(startedAtCalls, 1);
  storage.withLock(
    Date.parse('2026-08-09T10:05:00.000Z'),
    null,
    (state) => state
  );
  assert.equal(startedAtCalls, 1);
});
