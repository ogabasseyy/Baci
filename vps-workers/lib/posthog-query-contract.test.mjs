import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { posthogQueryContract as posthogQuery } from './posthog-query-contract.mjs';

describe('PostHog query contract', () => {
  it('exposes a single shared namespace', () => {
    assert.deepEqual(Object.keys(posthogQuery).sort(), [
      'MAX_RESPONSE_BYTES',
      'OCCURRENCE_WINDOW',
      'boundedString',
      'safeIssueId',
    ]);
  });

  it('pins the shared window, byte cap, and issue-ID shapes', () => {
    assert.equal(posthogQuery.OCCURRENCE_WINDOW, '-7d');
    assert.equal(posthogQuery.MAX_RESPONSE_BYTES, 1_000_000);
    assert.equal(
      posthogQuery.safeIssueId('01961f15-9db7-4b9c-9c1a-51e2b823a003'),
      '01961f15-9db7-4b9c-9c1a-51e2b823a003'
    );
    assert.equal(posthogQuery.safeIssueId('alice@example.com'), '');
    assert.equal(posthogQuery.safeIssueId('AliceSmith_customer'), '');
    assert.equal(posthogQuery.safeIssueId('08031234567'), '');
    assert.equal(posthogQuery.safeIssueId('posthog-issue-1'), '');
    assert.equal(posthogQuery.boundedString('  padded  ', 6), 'padded');
  });
});
