import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { createRemediationPrJournal } from './remediation-pr-journal.mjs';

it('reclaims a stale PR journal lock after a worker crash', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-pr-journal-stale-'));
  const path = join(directory, 'journal.json');
  const lockPath = `${path}.lock`;
  const nowMs = Date.parse('2026-08-09T10:05:00.000Z');
  const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  writeFileSync(
    `${lockPath}.owner-${token}`,
    JSON.stringify({
      createdAt: '2026-08-09T10:00:00.000Z',
      pid: 2_147_483_647,
      token,
    })
  );
  writeFileSync(
    lockPath,
    JSON.stringify({
      createdAt: '2026-08-09T10:00:00.000Z',
      pid: 2_147_483_647,
      token,
    })
  );
  const journal = createRemediationPrJournal({
    now: () => nowMs,
    path,
    processIsAlive: () => false,
  });

  journal.record({
    candidate: {
      caseKey: 'sentry:sentry_issue:stale-lock',
      fingerprint: 'stale-lock',
      observationMarker: '2026-08-09T10:00:00.000Z',
    },
    result: {
      branch: 'codex/fix-stale-lock',
      prUrl: 'https://github.com/baci/baci/pull/88',
    },
  });

  assert.equal(journal.entries().length, 1);
});

it('does not reclaim an old lock held by a live owner', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-pr-journal-live-'));
  const path = join(directory, 'journal.json');
  const lockPath = `${path}.lock`;
  const nowMs = Date.parse('2026-08-09T10:05:00.000Z');
  const token = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const owner = JSON.stringify({
    createdAt: '2026-08-09T10:00:00.000Z',
    pid: process.pid,
    token,
  });
  writeFileSync(`${lockPath}.owner-${token}`, owner);
  writeFileSync(lockPath, owner);
  const journal = createRemediationPrJournal({
    now: () => nowMs,
    path,
    processIsAlive: () => true,
  });

  assert.throws(
    () =>
      journal.record({
        candidate: {
          caseKey: 'sentry:sentry_issue:live-lock',
          fingerprint: 'live-lock',
          observationMarker: '2026-08-09T10:00:00.000Z',
        },
        result: {
          branch: 'codex/fix-live-lock',
          prUrl: 'https://github.com/baci/baci/pull/89',
        },
      }),
    /remediation PR journal is busy/
  );
});

it('reclaims a stale journal lock after its PID has been reused', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-pr-journal-pid-reuse-'));
  const path = join(directory, 'journal.json');
  const token = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const owner = JSON.stringify({
    createdAt: '2026-08-09T10:00:00.000Z',
    pid: 42,
    processStartedAt: 'original-process',
    token,
  });
  writeFileSync(`${path}.lock.owner-${token}`, owner);
  writeFileSync(`${path}.lock`, owner);
  const journal = createRemediationPrJournal({
    now: () => Date.parse('2026-08-09T10:05:00.000Z'),
    path,
    processIsAlive: () => true,
    processStartedAt: () => 'reused-process',
  });

  journal.record({
    candidate: {
      caseKey: 'sentry:sentry_issue:pid-reuse',
      fingerprint: 'pid-reuse',
      observationMarker: '2026-08-09T10:00:00.000Z',
    },
    result: {
      branch: 'codex/fix-pid-reuse',
      prUrl: 'https://github.com/baci/baci/pull/90',
    },
  });

  assert.equal(journal.entries().length, 1);
});
