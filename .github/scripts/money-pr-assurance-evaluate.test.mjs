import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claudeVerdict,
  codexClean,
  comment,
  EVIDENCE_PATH,
  HEAD,
  loadRawConfig,
  moneySnapshot,
  OLD_HEAD,
  ownerApproval,
  SUMMARY_PATH,
  validSummary,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import {
  evaluateAssurance,
  summaryPathsToFetch,
} from './money-pr-assurance-evaluate.mjs';

const config = parseAssuranceConfig(loadRawConfig());

function evaluate(overrides) {
  return evaluateAssurance(moneySnapshot(overrides), config);
}

function assertFails(result, pattern) {
  assert.equal(result.state, 'failure');
  assert.match(result.reasons.join('\n'), pattern);
  assert.ok(result.description.length <= 140);
}

test('a non-money PR passes without any reviews', () => {
  const result = evaluateAssurance(
    {
      pr: { number: 1, headSha: HEAD, body: '', labels: [], changedFiles: 1 },
      files: [
        { filename: 'apps/web/src/components/hero.tsx', status: 'modified' },
      ],
    },
    config
  );
  assert.equal(result.state, 'success');
  assert.equal(result.moneyPath, false);
  assert.match(result.description, /Not a money-path PR/);
});

test('a money PR with every requirement met passes', () => {
  const result = evaluate({});
  assert.equal(result.state, 'success', result.reasons.join('\n'));
  assert.equal(result.moneyPath, true);
  assert.deepEqual(result.reasons, []);
});

test('a money PR fails without a summary', () => {
  assertFails(
    evaluate({
      files: [
        {
          filename: 'apps/web/src/lib/piggyvest/transfer.ts',
          status: 'modified',
        },
      ],
      summaries: {},
    }),
    /No owner-readable summary/
  );
  assertFails(
    evaluate({ summaries: { [SUMMARY_PATH]: null } }),
    /could not be read/
  );
});

test('a money PR fails with only one reviewer family', () => {
  assertFails(
    evaluate({ comments: [codexClean(), ownerApproval()] }),
    /claude or gemini/i
  );
});

test('a money PR fails when the verdicts are on an old SHA', () => {
  assertFails(
    evaluate({
      comments: [
        codexClean(OLD_HEAD),
        claudeVerdict({ sha: OLD_HEAD }),
        ownerApproval(),
      ],
    }),
    /codex/i
  );
});

test('a money PR fails with an unresolved review thread', () => {
  assertFails(
    evaluate({ threads: [{ isResolved: false, path: 'a.ts' }] }),
    /1 review thread is unresolved/
  );
});

test('a money PR fails without sandbox evidence or a dark-until statement', () => {
  assertFails(
    evaluate({ pr: { body: 'No evidence here.' } }),
    /sandbox evidence/
  );
  assertFails(
    evaluate({ evidenceExists: { [EVIDENCE_PATH]: false } }),
    /not found at the head commit/
  );
  const dark = evaluate({
    pr: { body: 'Dark until: the transfer engine flag is on' },
  });
  assert.equal(dark.state, 'success', dark.reasons.join('\n'));
});

test('owner sign-off is required, bound to the owner and the current head', () => {
  const without = [codexClean(), claudeVerdict()];
  assertFails(evaluate({ comments: without }), /summary-approved 0123456/);
  assertFails(
    evaluate({ comments: [...without, ownerApproval(HEAD, 'someone-else')] }),
    /summary-approved/
  );
  assertFails(
    evaluate({ comments: [...without, ownerApproval(OLD_HEAD)] }),
    /summary-approved/
  );
  const notRequired = evaluate({
    comments: without,
    summaries: { [SUMMARY_PATH]: validSummary({ signoff: 'not required' }) },
  });
  assert.equal(notRequired.state, 'success', notRequired.reasons.join('\n'));
  // The owner-signoff label turns sign-off on even if the summary says otherwise.
  assertFails(
    evaluate({
      comments: without,
      pr: { labels: ['owner-signoff'] },
      summaries: { [SUMMARY_PATH]: validSummary({ signoff: 'not required' }) },
    }),
    /summary-approved/
  );
});

test('a summary with code, too many words or a missing heading fails', () => {
  const sql = validSummary({ extra: '\nSELECT amount FROM wallets\n' });
  assertFails(evaluate({ summaries: { [SUMMARY_PATH]: sql } }), /SQL/);
  const long = validSummary({ extra: `\n${'word '.repeat(450)}\n` });
  assertFails(evaluate({ summaries: { [SUMMARY_PATH]: long } }), /450-word/);
  const missing = validSummary().replace('## Why\n', '');
  assertFails(
    evaluate({ summaries: { [SUMMARY_PATH]: missing } }),
    /Missing heading "Why"/
  );
});

test('owner sign-off never waives any other requirement', () => {
  assertFails(evaluate({ comments: [ownerApproval()] }), /codex/i);
  assertFails(
    evaluate({
      comments: [ownerApproval(), comment('ogabasseyy', 'bypass please', 9)],
    }),
    /codex/i
  );
});

test('failing checks fail and running checks keep the status pending', () => {
  const failed = evaluate({
    checkRuns: [
      {
        id: 1,
        name: 'Quality Gate',
        status: 'completed',
        conclusion: 'success',
        startedAt: '',
      },
      {
        id: 2,
        name: 'Quality Gate - DB Replay',
        status: 'completed',
        conclusion: 'failure',
        startedAt: '',
      },
      {
        id: 3,
        name: 'Quality Gate - Disposable SQL Suites',
        status: 'completed',
        conclusion: 'success',
        startedAt: '',
      },
    ],
  });
  assertFails(failed, /DB Replay/);
  const running = evaluate({
    checkRuns: [
      {
        id: 1,
        name: 'Quality Gate',
        status: 'in_progress',
        conclusion: null,
        startedAt: '',
      },
    ],
  });
  assert.equal(running.state, 'pending');
  assert.match(running.description, /Waiting/);
});

test('an incomplete changed-file list is treated as a money-path PR', () => {
  const result = evaluateAssurance(
    {
      pr: {
        number: 1,
        headSha: HEAD,
        body: '',
        labels: [],
        changedFiles: 4000,
      },
      files: [
        { filename: 'apps/web/src/components/hero.tsx', status: 'modified' },
      ],
      summaries: {},
      evidenceExists: {},
      comments: [],
      reviews: [],
      threads: [],
      checkRuns: [],
    },
    config
  );
  assert.equal(result.moneyPath, true);
  assertFails(result, /changed-file list is incomplete/);
});

test('summary paths to fetch come from the changed files', () => {
  assert.deepEqual(summaryPathsToFetch(moneySnapshot().files, config), [
    SUMMARY_PATH,
  ]);
});

test('control characters from PR content never reach the status text', () => {
  const sneaky = 'docs/piggyvest-change-summaries/x\n::error::forged.md';
  const result = evaluate({
    files: [...moneySnapshot().files, { filename: sneaky, status: 'added' }],
  });
  assert.equal(result.state, 'failure');
  assert.doesNotMatch(result.description, /\p{Cc}/u);
  for (const reason of result.reasons) {
    assert.doesNotMatch(reason, /\p{Cc}/u);
  }
});
