import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRemediationPrBody } from './remediation-pr-body.mjs';

describe('remediation PR body', () => {
  it('summarizes bounded lifecycle evidence without provider payload data', () => {
    const body = buildRemediationPrBody({
      caseId: 'sentry:sentry_issue:customer@example.test',
      category: 'sentry_issue',
      occurrences: 3,
      recurrenceCount: 2,
      status: 'pr_open',
      history: [{ at: '2026-08-09T10:00:00.000Z', type: 'prompt_written' }],
      sample: {
        message: 'customer@example.test <script>alert(1)</script>',
        source: 'vercel',
      },
    });

    assert.match(body, /Case: sentry:sentry_issue:\[REDACTED_EMAIL\]/);
    assert.match(body, /Category: sentry_issue/);
    assert.match(body, /Lifecycle status: pr_open/);
    assert.match(body, /Recurrences: 2/);
    assert.match(body, /- prompt_written at 2026-08-09T10:00:00.000Z/);
    assert.doesNotMatch(body, /[<>]/);
    assert.doesNotMatch(body, /customer@example\.test/);
  });

  it('withholds a non-HTTPS draft PR URL', () => {
    const body = buildRemediationPrBody({
      draftPr: { url: 'javascript:alert(1)' },
    });

    assert.doesNotMatch(body, /javascript:alert/);
  });
});
