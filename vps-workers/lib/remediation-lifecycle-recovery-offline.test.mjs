import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { createRemediationCaseState } from './remediation-case-state.mjs';
import { reconcileRemediationLifecycle } from './remediation-lifecycle-recovery.mjs';
import { createRemediationPrJournal } from './remediation-pr-journal.mjs';

it('replays and reports a first-attempt PR after the provider candidate disappears', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-offline-pr-recovery-'));
  const nowMs = Date.parse('2026-08-09T10:05:00.000Z');
  const candidate = {
    category: 'sentry_issue',
    fingerprint: 'offline-1',
    lastSeen: '2026-08-09T10:00:00.000Z',
    occurrences: 2,
    sample: { issueId: 'offline-1', source: 'sentry' },
    source: 'sentry',
  };
  const caseState = createRemediationCaseState({
    now: () => nowMs,
    path: join(directory, 'cases.json'),
  });
  const selected = caseState.recordSelections(caseState.reconcile([candidate]));
  const journal = createRemediationPrJournal({
    now: () => nowMs,
    path: join(directory, 'journal.json'),
  });
  journal.record({
    candidate: selected[0],
    result: {
      branch: 'codex/fix-offline-1',
      prUrl: 'https://github.com/baci/baci/pull/91',
    },
  });
  const completed = [];

  const recovered = reconcileRemediationLifecycle({
    candidates: [],
    caseState,
    journal,
    state: {
      complete: ({ handledCandidates }) => {
        completed.push(...handledCandidates);
        return true;
      },
      handledCandidates: () => [],
    },
  });

  assert.equal(journal.entries().length, 0);
  assert.equal(completed[0].status, 'pr_open');
  assert.equal(recovered[0].lifecycleEvent, 'pr_recovered');
  assert.equal(recovered[0].autofixEligible, false);
  assert.equal(
    recovered[0].draftPr.url,
    'https://github.com/baci/baci/pull/91'
  );
});
