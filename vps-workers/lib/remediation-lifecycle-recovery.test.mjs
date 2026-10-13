import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcileRemediationLifecycle } from './remediation-lifecycle-recovery.mjs';

describe('remediation lifecycle recovery', () => {
  it('fails closed when the handled-state read cannot acquire its lock', () => {
    assert.throws(
      () =>
        reconcileRemediationLifecycle({
          candidates: [],
          caseState: {
            migrateLegacyHandled: () => {
              throw new Error('must not migrate from an unlocked state read');
            },
          },
          journal: { entries: () => [] },
          state: { handledCandidates: () => false },
        }),
      /remediation state is busy/
    );
  });

  it('clears a PR journal entry only after lifecycle and legacy checkpoints succeed', () => {
    const candidate = { caseKey: 'sentry:sentry_issue:1', fingerprint: '1' };
    const calls = [];
    const recovered = reconcileRemediationLifecycle({
      candidates: [candidate],
      caseState: {
        migrateLegacyHandled: () => true,
        reconcile: () => [candidate],
        recordOutcome: () => {
          calls.push('lifecycle');
          return true;
        },
      },
      journal: {
        clear: () => calls.push('clear'),
        entries: () => [{ caseKey: candidate.caseKey, type: 'pr_opened' }],
      },
      state: {
        complete: () => {
          calls.push('legacy');
          return true;
        },
        handledCandidates: () => [],
      },
    });

    assert.deepEqual(recovered, [
      {
        ...candidate,
        autofixEligible: false,
        lifecycleEvent: 'pr_recovered',
      },
    ]);
    assert.deepEqual(calls, ['lifecycle', 'legacy', 'clear']);
  });

  it('replays only an exact canonical case key from the reconciled candidates', () => {
    const entry = {
      caseKey: 'sentry:sentry_issue:1',
      fingerprint: '1',
      type: 'pr_opened',
    };
    const replayed = {
      ...entry,
      category: 'sentry_issue',
      recurrenceCount: 1,
      source: 'sentry',
      status: 'pr_open',
    };
    const canonicalCandidate = {
      caseKey: entry.caseKey,
      category: 'sentry_issue',
      fingerprint: '1',
      sample: { source: 'sentry' },
      source: 'sentry',
    };
    let reconcileCalls = 0;
    const recovered = reconcileRemediationLifecycle({
      candidates: [canonicalCandidate],
      caseState: {
        migrateLegacyHandled: () => true,
        reconcile: () =>
          reconcileCalls++ === 0 ? [canonicalCandidate] : [replayed],
        recordOutcome: (candidate) => {
          assert.equal(candidate.caseKey, entry.caseKey);
          return replayed;
        },
      },
      journal: { clear: () => undefined, entries: () => [entry] },
      state: { complete: () => true, handledCandidates: () => [] },
    });

    assert.deepEqual(recovered, [
      {
        ...replayed,
        autofixEligible: false,
        lifecycleEvent: 'active_draft_recurrence',
      },
    ]);
  });

  it('retains a corrupt cross-provider journal entry with a matching fingerprint', () => {
    const entry = {
      caseKey: 'sentry:sentry_issue:shared-fingerprint',
      fingerprint: 'shared-fingerprint',
      type: 'pr_opened',
    };
    const calls = [];
    const recovered = reconcileRemediationLifecycle({
      candidates: [
        {
          caseKey: 'vercel:vercel_runtime_exception:shared-fingerprint',
          category: 'vercel_runtime_exception',
          fingerprint: 'shared-fingerprint',
          source: 'vercel',
        },
      ],
      caseState: {
        migrateLegacyHandled: () => true,
        reconcile: () => [],
        recordOutcome: () => calls.push('lifecycle'),
        snapshot: () => ({ cases: {} }),
      },
      journal: {
        clear: () => calls.push('clear'),
        entries: () => [entry],
      },
      state: {
        complete: () => calls.push('legacy'),
        handledCandidates: () => [],
      },
    });

    assert.deepEqual(recovered, []);
    assert.deepEqual(calls, []);
  });
});
