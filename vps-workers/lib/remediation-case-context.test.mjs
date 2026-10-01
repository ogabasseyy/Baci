import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { candidateWithLifecycle } from './remediation-case-context.mjs';

describe('remediation case context', () => {
  it('attaches bounded current and same-category lifecycle evidence', () => {
    const candidate = {
      caseKey: 'vercel:vercel_timeout:current',
      category: 'vercel_timeout',
    };
    const state = {
      cases: {
        [candidate.caseKey]: {
          draftPr: null,
          key: candidate.caseKey,
          outcomes: [{ type: 'autofix_failed' }],
          recurrenceCount: 2,
          status: 'open',
        },
        'vercel:vercel_timeout:prior': {
          category: 'vercel_timeout',
          draftPr: null,
          fingerprint: 'prior',
          firstSeen: '',
          key: 'vercel:vercel_timeout:prior',
          lastSeen: '2026-08-09T10:00:00.000Z',
          outcomes: [],
          recurrenceCount: 0,
          samples: [],
          source: 'vercel',
          status: 'open',
          totalObservations: 1,
        },
      },
    };

    const result = candidateWithLifecycle(state, candidate, {
      autofixEligible: true,
    });

    assert.equal(result.history[0].type, 'autofix_failed');
    assert.equal(result.caseContext.cases[0].fingerprint, 'prior');
    assert.equal(result.autofixEligible, true);
  });

  it('handles missing optional context fields and rejects a missing current case', () => {
    const candidate = {
      caseKey: 'sentry:sentry_issue:current',
      category: 'sentry_issue',
      fingerprint: 'current',
      untrustedPayload: 'do-not-carry',
    };
    const state = {
      cases: {
        [candidate.caseKey]: {
          key: candidate.caseKey,
          recurrenceCount: 0,
          status: 'open',
        },
        'sentry:sentry_issue:prior': {
          category: 'sentry_issue',
          key: 'sentry:sentry_issue:prior',
        },
      },
    };

    const result = candidateWithLifecycle(state, candidate);

    assert.deepEqual(result.caseContext.cases[0].outcomes, []);
    assert.deepEqual(result.caseContext.cases[0].samples, []);
    assert.equal(result.caseContext.cases[0].lastSeen, '');
    assert.deepEqual(result.history, []);
    assert.equal(result.untrustedPayload, undefined);
    assert.throws(
      () => candidateWithLifecycle({ cases: {} }, candidate),
      /Missing remediation lifecycle case/
    );
  });
});
