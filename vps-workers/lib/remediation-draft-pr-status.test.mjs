import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createRemediationDraftPrStatusResolver } from './remediation-draft-pr-status.mjs';

it('reads open, closed, and merged states from GitHub pull request metadata', () => {
  const responses = [
    { mergedAt: null, state: 'OPEN' },
    { mergedAt: null, state: 'CLOSED' },
    { mergedAt: '2026-08-09T10:00:00Z', state: 'CLOSED' },
  ];
  const calls = [];
  const resolveDraftPrStatus = createRemediationDraftPrStatusResolver({
    runner: (command, args, options) => {
      calls.push({ args, command, options });
      return JSON.stringify(responses.shift());
    },
  });

  assert.equal(
    resolveDraftPrStatus({ url: 'https://github.com/baci/baci/pull/12' }),
    'open'
  );
  assert.equal(
    resolveDraftPrStatus({ url: 'https://github.com/baci/baci/pull/12' }),
    'closed'
  );
  assert.equal(
    resolveDraftPrStatus({ url: 'https://github.com/baci/baci/pull/12' }),
    'merged'
  );
  assert.deepEqual(calls[0], {
    args: [
      'pr',
      'view',
      'https://github.com/baci/baci/pull/12',
      '--json',
      'state,mergedAt',
    ],
    command: 'gh',
    options: { encoding: 'utf8', shell: false, timeout: 10_000 },
  });
});

it('rejects invalid URLs and redacts GitHub lookup failures', () => {
  const resolveDraftPrStatus = createRemediationDraftPrStatusResolver({
    runner: () => {
      throw new Error('Authorization: Bearer ghp_abcdefghijklmnopqrstuvwx');
    },
  });

  assert.throws(
    () => resolveDraftPrStatus({ url: 'https://example.test/pull/12' }),
    /invalid/
  );
  assert.throws(
    () => resolveDraftPrStatus({ url: 'https://github.com/baci/baci/pull/12' }),
    (error) =>
      error instanceof Error &&
      !error.message.includes('ghp_abcdefghijklmnopqrstuvwx') &&
      error.message.includes('[REDACTED]')
  );
});

it('accepts a direct merged state and rejects non-JSON GitHub output', () => {
  const responses = [
    JSON.stringify({ mergedAt: null, state: 'MERGED' }),
    'not-json',
  ];
  const resolveDraftPrStatus = createRemediationDraftPrStatusResolver({
    runner: () => responses.shift(),
  });
  const draftPr = { url: 'https://github.com/baci/baci/pull/12' };

  assert.equal(resolveDraftPrStatus(draftPr), 'merged');
  assert.throws(() => resolveDraftPrStatus(draftPr), /Unexpected token/);
});
