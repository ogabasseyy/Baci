import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  matchingHandledEntry,
  remediationObservationFor,
  remediationStateKeyFor,
} from './remediation-state-key.mjs';

it('prefers canonical case identity and requires an exact legacy observation', () => {
  const candidate = {
    caseKey: 'vercel:vercel_http_5xx:shared',
    fingerprint: 'shared',
    lastSeen: '2026-08-09T10:00:00.000Z',
    occurrences: 2,
  };
  assert.equal(remediationStateKeyFor(candidate), candidate.caseKey);
  const entry = {
    observation: remediationObservationFor(candidate),
    recordedAt: '2026-08-09T10:01:00.000Z',
  };
  assert.deepEqual(
    matchingHandledEntry({ [candidate.caseKey]: entry }, candidate),
    entry
  );
  assert.equal(
    matchingHandledEntry(
      {
        shared: {
          observation: '2026-08-09T09:00:00.000Z',
          recordedAt: '2026-08-09T09:01:00.000Z',
        },
      },
      candidate
    ),
    null
  );

  assert.equal(
    matchingHandledEntry(
      Object.create({
        [candidate.caseKey]: entry,
        shared: entry,
      }),
      candidate
    ),
    null
  );
});

it('distinguishes occurrence growth observed at the same timestamp', () => {
  const firstObservation = {
    caseKey: 'vercel:vercel_http_5xx:shared',
    lastSeen: '2026-08-09T10:00:00.000Z',
    occurrences: 2,
  };
  const recurrence = {
    ...firstObservation,
    occurrences: 3,
  };

  const handled = {
    'vercel:vercel_http_5xx:shared': {
      observation: remediationObservationFor(firstObservation),
    },
  };

  assert.equal(
    remediationObservationFor(firstObservation),
    '2026-08-09T10:00:00.000Z:2'
  );
  assert.equal(matchingHandledEntry(handled, recurrence), null);
  assert.deepEqual(
    matchingHandledEntry(handled, firstObservation),
    handled['vercel:vercel_http_5xx:shared']
  );
});

it('does not assign a shared key to candidates without an identity', () => {
  const candidate = { lastSeen: '2026-08-09T10:00:00.000Z', occurrences: 2 };

  assert.equal(remediationStateKeyFor(candidate), '');
  assert.equal(
    matchingHandledEntry(
      { unknown: { observation: remediationObservationFor(candidate) } },
      candidate
    ),
    null
  );
});
