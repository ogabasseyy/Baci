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
      posthogQuery.safeIssueId('019611e5-abc_DEF-42'),
      '019611e5-abc_DEF-42'
    );
    assert.equal(posthogQuery.safeIssueId('alice@example.com'), '');
    assert.equal(posthogQuery.boundedString('  padded  ', 6), 'padded');
  });
});
