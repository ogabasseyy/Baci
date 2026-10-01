import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createRemediationDraftPrReconciler } from './remediation-draft-pr-reconciliation.mjs';

it('reuses only the open draft for an observation-scoped branch', () => {
  const calls = [];
  const reconciler = createRemediationDraftPrReconciler({
    candidate: {
      caseKey: 'sentry:sentry_issue:issue-42',
      category: 'sentry_issue',
      fingerprint: 'issue-42',
      observationMarker: '2026-08-09T10:00:00.000Z',
      source: 'sentry',
    },
    ghBin: 'gh',
    options: {
      cwd: '/repo',
      env: { GH_TOKEN: 'token' },
      runner(command, args) {
        calls.push([command, ...args]);
        return {
          status: 0,
          stderr: '',
          stdout:
            command === 'gh'
              ? '[{"url":"https://github.com/ogabasseyy/Baci/pull/999"}]\n'
              : '',
        };
      },
    },
  });

  assert.match(
    reconciler.branch,
    /^codex\/sentry-remediation-sentry-issue-issue-42-[a-f0-9]{12}$/
  );
  assert.equal(
    reconciler.existingDraftPrUrl(),
    'https://github.com/ogabasseyy/Baci/pull/999'
  );
  assert.deepEqual(calls[0].slice(0, 2), ['gh', 'pr']);
  assert.equal(calls[0][calls[0].indexOf('--head') + 1], reconciler.branch);
  assert.equal(calls[0][calls[0].indexOf('--state') + 1], 'open');
});

it('rejects malformed, ambiguous, and unsafe draft PR lookup output', () => {
  for (const [output, expected] of [
    ['not-json', /invalid JSON/],
    ['{}', /invalid result/],
    [
      '[{"url":"https://github.com/baci/baci/pull/1"},{"url":"https://github.com/baci/baci/pull/2"}]',
      /invalid result/,
    ],
    ['[{"url":"http://github.com/baci/baci/pull/1"}]', /invalid URL/],
  ]) {
    const reconciler = createRemediationDraftPrReconciler({
      candidate: { fingerprint: 'issue-42' },
      ghBin: 'gh',
      options: {
        cwd: '/repo',
        env: {},
        runner: () => ({ status: 0, stderr: '', stdout: output }),
      },
    });

    assert.throws(() => reconciler.existingDraftPrUrl(), expected);
  }
});

it('recovers a lost draft-create response when a subsequent lookup finds the PR', () => {
  let lookups = 0;
  const reconciler = createRemediationDraftPrReconciler({
    candidate: { fingerprint: 'issue-42' },
    ghBin: 'gh',
    options: {
      cwd: '/repo',
      env: {},
      runner: (command, args) => {
        if (command === 'gh' && args.includes('list')) {
          lookups++;
          return {
            status: 0,
            stderr: '',
            stdout:
              lookups === 1
                ? '[]\n'
                : '[{"url":"https://github.com/baci/baci/pull/1"}]\n',
          };
        }
        return { status: 1, stderr: 'draft create response lost', stdout: '' };
      },
    },
  });

  assert.equal(
    reconciler.createOrReuseDraftPr(),
    'https://github.com/baci/baci/pull/1'
  );
});

it('preserves a draft-create failure when recovery lookup also fails', () => {
  let lookups = 0;
  const reconciler = createRemediationDraftPrReconciler({
    candidate: { fingerprint: 'issue-42' },
    ghBin: 'gh',
    options: {
      cwd: '/repo',
      env: {},
      runner: (command, args) => {
        if (command === 'gh' && args.includes('list')) {
          lookups++;
          return lookups === 1
            ? { status: 0, stderr: '', stdout: '[]\n' }
            : { status: 1, stderr: 'recovery lookup failed', stdout: '' };
        }
        return { status: 1, stderr: 'draft create failed', stdout: '' };
      },
    },
  });

  assert.throws(() => reconciler.createOrReuseDraftPr(), /draft create failed/);
});
