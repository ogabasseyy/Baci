import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { createRemediationPrJournal } from './remediation-pr-journal.mjs';

it('reclaims an expired journal lock from a dead process', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-pr-journal-stale-lock-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const path = join(directory, 'journal.json');
  writeFileSync(
    `${path}.lock`,
    JSON.stringify({
      createdAt: '2026-08-09T10:00:00.000Z',
      pid: 1234,
      processStartedAt: 'old process',
      token: '00000000-0000-4000-8000-000000000000',
    })
  );
  const journal = createRemediationPrJournal({
    now: () => Date.parse('2026-08-09T10:03:00.000Z'),
    path,
    processIsAlive: () => false,
    processStartedAt: () => 'current process',
  });

  journal.record({
    candidate: {
      caseKey: 'sentry:sentry_issue:stale-lock',
      fingerprint: 'stale-lock',
      observationMarker: '2026-08-09T10:00:00.000Z',
    },
    result: {
      branch: 'codex/fix-stale-lock',
      prUrl: 'https://github.com/baci/baci/pull/99',
    },
  });

  assert.equal(journal.entries()[0].fingerprint, 'stale-lock');
  assert.equal(existsSync(`${path}.lock`), false);
});
