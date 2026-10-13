import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRemediationCaseStateValidator } from './remediation-case-state-validation.mjs';

const validator = createRemediationCaseStateValidator({
  caseStatuses: new Set(['open', 'investigating', 'pr_open', 'quiet']),
  maxCases: 1,
  maxOutcomes: 1,
  maxSamples: 1,
  version: 1,
});
const caseKey = 'k'.repeat(300);

function validState() {
  return {
    cases: {
      [caseKey]: {
        category: 'c'.repeat(120),
        draftPr: { openedAt: '2026-08-01T10:00:00.000Z', url: 'u'.repeat(500) },
        firstSeen: '2026-08-01T10:00:00.000Z',
        fingerprint: 'f'.repeat(120),
        key: caseKey,
        lastSeen: '2026-08-01T10:01:00.000Z',
        observationMarker: 'm'.repeat(120),
        observedOccurrences: 1,
        outcomes: [
          {
            at: '2026-08-01T10:01:00.000Z',
            detail: 'd'.repeat(500),
            prUrl: 'u'.repeat(500),
            type: 't'.repeat(80),
          },
        ],
        recurrenceCount: 0,
        samples: [
          {
            message: 'm'.repeat(1_000),
            source: 'sentry',
            statusCode: '5'.repeat(12),
            stackSummary: Array.from({ length: 32 }, () => 's'.repeat(240)),
          },
        ],
        source: 's'.repeat(120),
        status: 'open',
        totalObservations: 1,
      },
    },
    fairness: { lastCategory: 'c'.repeat(80) },
    version: 1,
  };
}

describe('remediation case state validation', () => {
  it('accepts an exactly bounded lifecycle state', () => {
    assert.equal(validator(validState()), true);
  });

  it('rejects unknown, oversized, malformed, and non-map lifecycle state', () => {
    const valid = validState();
    const record = valid.cases[caseKey];
    const invalidStates = [
      { ...valid, unknown: true },
      { ...valid, fairness: { lastCategory: 'c'.repeat(81) } },
      {
        ...valid,
        cases: {
          [caseKey]: record,
          another: { ...record, key: 'another' },
        },
      },
      {
        ...valid,
        cases: {
          [`${caseKey}k`]: { ...record, key: `${caseKey}k` },
        },
      },
      {
        ...valid,
        cases: {
          [caseKey]: {
            ...record,
            outcomes: [...record.outcomes, { ...record.outcomes[0] }],
          },
        },
      },
      {
        ...valid,
        cases: {
          [caseKey]: {
            ...record,
            samples: [{ source: 'sentry' }, { source: 'sentry' }],
          },
        },
      },
      {
        ...valid,
        cases: {
          [caseKey]: { ...record, statusCode: { value: '500' } },
        },
      },
      {
        ...valid,
        cases: {
          [caseKey]: { ...record, statusCode: '500' },
        },
      },
      { ...valid, cases: [] },
      { ...valid, cases: { [caseKey]: { key: caseKey } } },
      {
        ...valid,
        cases: {
          [caseKey]: {
            ...record,
            firstSeen: '2026-08-01',
          },
        },
      },
      {
        ...valid,
        cases: {
          [caseKey]: {
            ...record,
            samples: [{ source: 'sentry', unknown: 'value' }],
          },
        },
      },
      {
        ...valid,
        cases: {
          [caseKey]: {
            ...record,
            samples: [{ ...record.samples[0], message: 'm'.repeat(1_001) }],
          },
        },
      },
      {
        ...valid,
        cases: {
          [caseKey]: {
            ...record,
            samples: [
              {
                ...record.samples[0],
                stackSummary: Array.from({ length: 33 }, () => 's'),
              },
            ],
          },
        },
      },
      {
        ...valid,
        cases: {
          [caseKey]: {
            ...record,
            draftPr: { openedAt: record.draftPr.openedAt },
          },
        },
      },
      {
        ...valid,
        cases: {
          [caseKey]: { ...record, draftPr: { ...record.draftPr, url: '' } },
        },
      },
      {
        ...valid,
        cases: {
          [caseKey]: {
            ...record,
            samples: [{ source: 'sentry', appLocation: 'private' }],
          },
        },
      },
    ];

    for (const invalid of invalidStates)
      assert.equal(validator(invalid), false);
  });

  it('rejects prototype-polluted maps and non-scalar status codes', () => {
    const polluted = validState();
    Object.setPrototypeOf(polluted.cases, { polluted: true });
    const statusCodeObject = validState();
    statusCodeObject.cases[caseKey].samples[0].statusCode = { value: '500' };

    assert.equal(validator(polluted), false);
    assert.equal(validator(statusCodeObject), false);
  });
});
