import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { createRemediationCaseState } from './remediation-case-state.mjs';

const candidate = (fingerprint, lastSeen) => ({
  category: 'sentry_issue',
  fingerprint,
  lastSeen,
  occurrences: 2,
  sample: { issueId: fingerprint, source: 'sentry' },
  source: 'sentry',
});

it('preserves an old active draft when the case ledger reaches its cap', () => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'baci-active-draft-cap-')),
    'cases.json'
  );
  const state = createRemediationCaseState({
    now: () => Date.parse('2026-08-03T00:00:00.000Z'),
    path,
  });
  const active = candidate('active-old', '2026-08-01T00:00:00.000Z');
  state.reconcile([active]);
  state.recordOutcome(active, {
    branch: 'codex/fix-active-old',
    prUrl: 'https://github.com/baci/baci/pull/77',
    type: 'pr_opened',
  });
  state.reconcile(
    Array.from({ length: 1_000 }, (_, index) =>
      candidate(
        `newer-${index}`,
        new Date(Date.parse('2026-08-02T00:00:00.000Z') + index).toISOString()
      )
    )
  );

  const cases = state.snapshot().cases;
  assert.equal(Object.keys(cases).length, 1_000);
  assert.equal(cases['sentry:sentry_issue:active-old'].status, 'pr_open');
  assert.equal(
    cases['sentry:sentry_issue:active-old'].draftPr.url,
    'https://github.com/baci/baci/pull/77'
  );
});
