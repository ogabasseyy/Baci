import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quietStaleRemediationCases } from './remediation-case-state-quiet.mjs';

describe('quiet stale remediation cases', () => {
  it('quiets stale actionable cases without changing legacy handled cases', () => {
    const state = {
      cases: {
        legacyHandled: {
          lastSeen: '2026-08-01T00:00:00.000Z',
          status: 'legacy_handled',
        },
        malformed: { lastSeen: 'not-a-date', status: 'open' },
        quiet: { lastSeen: '2026-08-01T00:00:00.000Z', status: 'quiet' },
        recentOpen: {
          lastSeen: '2026-08-01T00:00:00.001Z',
          status: 'open',
        },
        staleOpen: { lastSeen: '2026-08-01T00:00:00.000Z', status: 'open' },
      },
    };

    quietStaleRemediationCases(state, Date.parse('2026-08-08T00:00:00.000Z'));

    assert.equal(state.cases.staleOpen.status, 'quiet');
    assert.equal(state.cases.legacyHandled.status, 'legacy_handled');
    assert.equal(state.cases.recentOpen.status, 'open');
    assert.equal(state.cases.quiet.status, 'quiet');
    assert.equal(state.cases.malformed.status, 'open');
  });
});
