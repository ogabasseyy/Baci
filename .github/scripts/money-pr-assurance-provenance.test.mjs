// A required CI check counts only when the configured CI workflow produced
// it, and a money PR that also changes that CI needs the owner's sign-off.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CI_WORKFLOW,
  checkRun,
  codexClean,
  codexRequest,
  claudeVerdict,
  createFakeGitHub,
  HEAD,
  loadRawConfig,
  moneySnapshot,
  ownerApproval,
  passingChecks,
  SUMMARY_PATH,
  validSummary,
} from './money-pr-assurance.test-support.mjs';
import { readCheckRuns } from './money-pr-assurance-check-runs.mjs';
import { evaluateRequiredChecks } from './money-pr-assurance-checks.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';
import { evaluateAssurance } from './money-pr-assurance-evaluate.mjs';
import { createGitHubClient } from './money-pr-assurance-github.mjs';

const config = parseAssuranceConfig(loadRawConfig());

function checks(checkRuns) {
  return evaluateRequiredChecks({
    checkRuns,
    requiredChecks: config.requiredChecks,
    changedPaths: ['supabase/migrations/20261101000000_piggyvest_engine.sql'],
  });
}

test('every required check names the workflow that must produce it', () => {
  for (const check of config.requiredChecks)
    assert.equal(check.workflow, CI_WORKFLOW);
});

test('a same-named check from another workflow never satisfies a required check', () => {
  const [gate, , suites] = passingChecks();
  const real = checkRun('Quality Gate - DB Replay', 'failure', 11);
  const lookalike = checkRun(
    'Quality Gate - DB Replay',
    'success',
    99,
    '.github/workflows/lookalike.yml'
  );
  const result = checks([gate, real, lookalike, suites]);
  assert.match(result.failures.join('\n'), /DB Replay finished as failure/);
  const onlyLookalike = checks([gate, lookalike, suites]);
  assert.match(onlyLookalike.pending.join('\n'), /DB Replay has not finished/);
  const unknown = checks([
    gate,
    { ...checkRun('Quality Gate - DB Replay'), workflowPath: null },
    suites,
  ]);
  assert.match(unknown.pending.join('\n'), /DB Replay has not finished/);
});

test('check runs are tagged with the workflow file whose run produced them', async () => {
  const fake = createFakeGitHub({
    [`GET /repos/o/r/actions/runs?head_sha=${HEAD}&per_page=100`]: {
      json: {
        workflow_runs: [
          { check_suite_id: 50, path: CI_WORKFLOW },
          { check_suite_id: 60, path: '.github/workflows/other.yml@main' },
        ],
      },
    },
    [`GET /repos/o/r/commits/${HEAD}/check-runs?per_page=100`]: {
      json: {
        check_runs: [
          {
            id: 1,
            name: 'Quality Gate',
            status: 'completed',
            conclusion: 'success',
            started_at: 't',
            check_suite: { id: 50 },
          },
          {
            id: 2,
            name: 'Quality Gate',
            status: 'completed',
            conclusion: 'success',
            check_suite: { id: 60 },
          },
          { id: 3, name: 'External', status: 'queued', conclusion: null },
        ],
      },
    },
  });
  const client = createGitHubClient({
    token: 't',
    fetchImpl: fake.fetch,
    apiUrl: 'https://api.github.test',
  });
  const runs = await readCheckRuns(client, {
    owner: 'o',
    repo: 'r',
    sha: HEAD,
  });
  assert.deepEqual(
    runs.map(({ id, workflowPath }) => [id, workflowPath]),
    [
      [1, CI_WORKFLOW],
      [2, '.github/workflows/other.yml'],
      [3, null],
    ]
  );
  assert.equal(runs[0].startedAt, 't');
});

test('a money PR that also changes the CI producing its checks needs owner sign-off', () => {
  const comments = [codexRequest(), codexClean(), claudeVerdict()];
  const summaries = {
    [SUMMARY_PATH]: validSummary({ signoff: 'not required' }),
  };
  for (const filename of [
    '.github/workflows/ci.yml',
    '.github/filters/ci.yml',
  ]) {
    const files = [...moneySnapshot().files, { filename, status: 'modified' }];
    const result = evaluateAssurance(
      moneySnapshot({ files, summaries, comments }),
      config
    );
    assert.equal(result.state, 'failure');
    assert.match(result.reasons.join('\n'), /summary-approved 0123456/);
    const approved = evaluateAssurance(
      moneySnapshot({
        files,
        summaries,
        comments: [...comments, ownerApproval()],
      }),
      config
    );
    assert.equal(approved.state, 'success', approved.reasons.join('\n'));
  }
  // The same CI change in an ordinary PR is not a money-path PR.
  const ordinary = evaluateAssurance(
    {
      pr: { number: 1, headSha: HEAD, body: '', labels: [], changedFiles: 1 },
      files: [{ filename: '.github/workflows/ci.yml', status: 'modified' }],
    },
    config
  );
  assert.equal(ordinary.moneyPath, false);
});
