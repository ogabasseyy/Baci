import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createRemediationCaseState } from './remediation-case-state.mjs';

const candidate = (overrides = {}) => ({
  category: 'sentry_issue',
  fingerprint: 'issue-42',
  firstSeen: '2026-08-01T10:00:00.000Z',
  lastSeen: '2026-08-01T10:03:00.000Z',
  occurrences: 3,
  sample: {
    issueId: '42',
    message: 'Application Not Responding',
    project: 'mobile',
    source: 'sentry',
  },
  source: 'sentry',
  ...overrides,
});

describe('remediation case state evidence', () => {
  it('provides only bounded redacted same-category context', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-context-'));
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:04:00.000Z'),
      path: join(directory, 'cases.json'),
    });
    state.reconcile([
      candidate({
        fingerprint: 'first',
        sample: { source: 'sentry', message: 'token=super-secret-value' },
      }),
      candidate({
        fingerprint: 'second',
        sample: { source: 'sentry', message: 'Application Not Responding' },
      }),
    ]);

    const context = state.contextFor(candidate({ fingerprint: 'second' }));

    assert.equal(context.category, 'sentry_issue');
    assert.equal(context.cases.length, 1);
    assert.equal(context.cases[0].fingerprint, 'first');
    assert.equal(JSON.stringify(context).includes('super-secret-value'), false);
    assert.equal(context.cases[0].outcomes.length, 0);
  });

  it('does not persist email or phone-like provider evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-pii-'));
    const path = join(directory, 'cases.json');
    const state = createRemediationCaseState({
      now: () => Date.parse('2026-08-01T10:04:00.000Z'),
      path,
    });

    state.reconcile([
      candidate({
        sample: {
          message:
            'Error for alice@example.com phone +234 803 123 4567 or 08031234567 or 8031234567',
          route: '/orders?cursor=opaque-provider-value#receipt',
          source: 'sentry',
        },
      }),
    ]);

    const persisted = readFileSync(path, 'utf8');
    assert.doesNotMatch(persisted, /alice@example\.com/);
    assert.doesNotMatch(persisted, /234 803 123 4567/);
    assert.doesNotMatch(persisted, /08031234567/);
    assert.doesNotMatch(persisted, /8031234567/);
    assert.doesNotMatch(persisted, /opaque-provider-value/);
  });

  it('preserves allowlisted numeric Sentry identity while redacting message phones', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-case-sentry-identity-'));
    const path = join(directory, 'cases.json');
    const state = createRemediationCaseState({ path });

    state.reconcile([
      candidate({
        sample: {
          issueId: '08031234567',
          message: 'Customer phone 08031234567 caused an error',
          organization: 'baci-org',
          project: 'mobile-api',
          source: 'sentry',
        },
      }),
    ]);

    const persisted = readFileSync(path, 'utf8');
    assert.match(persisted, /"issueId": "08031234567"/);
    assert.match(persisted, /"organization": "baci-org"/);
    assert.match(persisted, /"project": "mobile-api"/);
    assert.doesNotMatch(persisted, /Customer phone 08031234567/);
  });
});
