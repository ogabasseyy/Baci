import assert from 'node:assert/strict';
import { it } from 'node:test';
import { capRemediationCases } from './remediation-case-cap.mjs';

it('reserves capped capacity for active draft cases', () => {
  const cases = {
    active: {
      draftPr: { url: 'https://example.test/pr/1' },
      lastSeen: '2026-08-01T00:00:00.000Z',
      status: 'quiet',
    },
    newer: { lastSeen: '2026-08-02T00:00:00.000Z', status: 'open' },
  };

  assert.deepEqual(Object.keys(capRemediationCases(cases, 1)), ['active']);
});
