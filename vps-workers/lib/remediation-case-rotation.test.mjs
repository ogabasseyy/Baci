import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareRemediationCasesByOutcomeRecency } from './remediation-case-rotation.mjs';

const outcomeAt = (at) => ({
  at,
  detail: 'prompt written',
  type: 'prompt_written',
});

describe('remediation case rotation', () => {
  it('orders unseen cases ahead of previously selected ones', () => {
    const cases = {
      'sentry:sentry_issue:hot-1': {
        outcomes: [outcomeAt('2026-08-01T10:04:00.000Z')],
      },
    };
    const group = [
      { caseKey: 'sentry:sentry_issue:hot-1' },
      { caseKey: 'sentry:sentry_issue:cold-1' },
    ];

    group.sort(compareRemediationCasesByOutcomeRecency(cases));

    assert.deepEqual(
      group.map((candidate) => candidate.caseKey),
      ['sentry:sentry_issue:cold-1', 'sentry:sentry_issue:hot-1']
    );
  });

  it('orders the least-recently served case first by trailing outcome', () => {
    const cases = {
      'sentry:sentry_issue:hot-1': {
        outcomes: [outcomeAt('2026-08-01T10:19:00.000Z')],
      },
      'sentry:sentry_issue:cold-1': {
        outcomes: [outcomeAt('2026-08-01T10:04:00.000Z')],
      },
    };
    const group = [
      { caseKey: 'sentry:sentry_issue:hot-1' },
      { caseKey: 'sentry:sentry_issue:cold-1' },
    ];

    group.sort(compareRemediationCasesByOutcomeRecency(cases));

    assert.deepEqual(
      group.map((candidate) => candidate.caseKey),
      ['sentry:sentry_issue:cold-1', 'sentry:sentry_issue:hot-1']
    );
  });
});
