// Contract tests for when the evaluator runs. GitHub runs some events from
// the pull request's own copy of a workflow; the evaluator must only ever run
// from the default branch, and CI must be able to satisfy what it requires.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadRawConfig,
  PROMPT_PATH,
  readRepoFile,
} from './money-pr-assurance.test-support.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';

const config = parseAssuranceConfig(loadRawConfig());
const workflow = readRepoFile('.github/workflows/money-pr-assurance.yml');
const relayPath = '.github/workflows/money-pr-assurance-review-relay.yml';
const relay = readRepoFile(relayPath);

function evaluateCondition() {
  return /\n {4}if: >-\n([\s\S]*?)\n {4}#/.exec(workflow)[1];
}

test('the evaluator only runs on events GitHub takes from the default branch', () => {
  const triggers = /^on:\n([\s\S]*?)\n\S/m.exec(workflow)[1];
  const events = [...triggers.matchAll(/^ {2}([a-z_]+):/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(events.sort(), [
    'issue_comment',
    'pull_request',
    'pull_request_target',
    'workflow_dispatch',
    'workflow_run',
  ]);
  const named = [
    ...evaluateCondition().matchAll(/github\.event_name == '([a-z_]+)'/g),
  ].map((match) => match[1]);
  assert.deepEqual([...new Set(named)].sort(), [
    'issue_comment',
    'pull_request_target',
    'workflow_dispatch',
    'workflow_run',
  ]);
  assert.doesNotMatch(workflow, /^ {2}pull_request_review:/m);
  assert.doesNotMatch(workflow, /event_name == 'pull_request_review'/);
});

test('review events reach the evaluator only through a permission-less relay', () => {
  assert.match(relay, /^permissions: \{\}$/m);
  assert.match(relay, /^ {2}pull_request_review:$/m);
  assert.doesNotMatch(relay, /secrets\.|uses:|github\.token|GITHUB_TOKEN/);
  const name = /^name: (.+)$/m.exec(relay)[1].trim();
  const runs = /workflows: \[([^\]]+)\]/
    .exec(workflow)[1]
    .split(',')
    .map((entry) => entry.trim());
  assert.ok(runs.includes(name), `${name} must be a workflow_run source`);
  assert.match(
    evaluateCondition(),
    /github\.event\.workflow_run\.event == 'pull_request_review'/
  );
});

test('the event head SHA is passed so a failed read can still replace a stale status', () => {
  assert.match(
    workflow,
    /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.event\.workflow_run\.head_sha \|\| '' \}\}/
  );
});

test('a skipped DB suite is accepted only for files that would not make CI run it', () => {
  const filter = readRepoFile('.github/filters/ci.yml');
  const block = /^quiz_db:\n((?: {2}- .+\n)+)/m.exec(filter);
  assert.ok(block, 'the CI filter must define quiz_db');
  const quizDb = [...block[1].matchAll(/- '([^']+)'/g)].map(
    (match) => match[1]
  );
  const ci = readRepoFile('.github/workflows/ci.yml');
  for (const check of config.requiredChecks) {
    if (!check.skipAllowedUnlessChanged) continue;
    const job = ci.indexOf(`    name: ${check.name}\n`);
    assert.ok(job > 0, `${check.name} must exist in CI`);
    assert.match(
      ci.slice(job, job + 400),
      /if: needs\.changes\.outputs\.quiz_db == 'true'/,
      `${check.name} must be gated by quiz_db`
    );
    for (const glob of check.skipAllowedUnlessChanged) {
      assert.ok(
        quizDb.includes(glob),
        `${glob} must be in the quiz_db filter, or CI may skip ${check.name} although the assurance requires it`
      );
    }
  }
});

test('the runbook asks reviewers for the money-rules prompt from the main branch', () => {
  const runbook = readRepoFile('docs/runbooks/money-pr-assurance.md');
  const codex = config.reviewers.families.codex;
  const request = runbook
    .split('\n')
    .find((line) => line.includes(codex.requestPhrase));
  assert.ok(request, 'the runbook must show the Codex request');
  assert.ok(request.includes(PROMPT_PATH));
  assert.match(request, /main branch/);
  const claude = runbook.split('\n').find((line) => line.includes('@claude'));
  assert.ok(claude?.includes(PROMPT_PATH));
  assert.match(claude, /main branch/);
});
