import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PR_HEAD_SHA, reviewStep, runWorkflowStep, stepEnv, workflow } from './jules-workflow.test-helpers.mjs';

function windowAt(day) {
  const dir = mkdtempSync(join(tmpdir(), 'jules-window-'));
  try {
    const date = join(dir, 'date');
    writeFileSync(date, '#!/bin/sh\n[ "$DATE_STUB" != "__fail__" ] || exit 1\nprintf "%s\\n" "$DATE_STUB"\n');
    chmodSync(date, 0o755);
    const output = join(dir, 'out');
    const summary = join(dir, 'summary');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-c', workflow.jobs.window.steps[0].run], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DATE_STUB: day, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
    });
    return { ...result, output: readFileSync(output, 'utf8'), summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('keeps Jules reviewing past November 11 and stops only at the 2027-01-01 backstop', () => {
  for (const [day, enabled] of [['2026-11-11', true], ['2026-11-12', true], ['2026-12-31', true], ['2027-01-01', false], ['2027-01-02', false]]) {
    const result = windowAt(day);
    assert.equal(result.status, 0, `${day}: ${result.stderr}`);
    assert.match(result.output, new RegExp(`enabled=${enabled}`), day);
    assert.equal(result.summary === '', enabled, `${day}: only a switched-off day explains itself`);
  }
  assert.deepEqual(workflow.jobs.review.needs, ['window']);
  assert.match(workflow.jobs.review.if, /needs\.window\.outputs\.enabled == 'true'/);
});
test('the backstop message gives the real reason and date', () => {
  const { summary } = windowAt('2027-01-01');
  assert.match(summary, /2026-12-31/);
  assert.match(summary, /2027-01-01/);
  assert.match(summary, /no review was started/);
  assert.doesNotMatch(summary, /read-only|November/);
});
test('invalid clock output cannot enable the review', () => {
  for (const day of ['invalid', '__fail__']) {
    const result = windowAt(day);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.output, /enabled=true/);
  }
});

test('preserves trusted event eligibility and does not grant the window job permissions', () => {
  const condition = workflow.jobs.window.if;
  assert.equal(condition, String.raw`(github.event_name == 'pull_request' && github.event.pull_request.draft == true && github.event.pull_request.head.repo.full_name == github.repository) || (github.event_name == 'issue_comment' && github.event.issue.pull_request && (github.event.comment.body == '/jules deep review' || startsWith(toJSON(github.event.comment.body), '"/jules deep review\n') || startsWith(toJSON(github.event.comment.body), '"/jules deep review\r\n')) && (github.event.comment.author_association == 'OWNER' || github.event.comment.author_association == 'MEMBER' || github.event.comment.author_association == 'COLLABORATOR'))`);
  assert.deepEqual(workflow.jobs.window.permissions, {});
  const submit = workflow.jobs.review.steps.find((step) => step.name === 'Submit Jules review');
  assert.equal(submit.if, '${{ always() && !cancelled() }}');
});

// Without a calendar cutoff, these limits are what stop a silent Jules from holding a runner for hours.
const MINUTE = 60;
const FAST = { EVENT_NAME: 'pull_request', REVIEW_MODE: 'fast', HEAD_SHA: PR_HEAD_SHA, PR_LABELS: '[]', COMMENT_BODY: '', COMMENT_AUTHOR_ASSOC: '' };
const DEEP = { EVENT_NAME: 'issue_comment', REVIEW_MODE: 'deep', HEAD_SHA: '', PR_LABELS: 'null', COMMENT_BODY: '/jules deep review', COMMENT_AUTHOR_ASSOC: 'OWNER' };

// Each wait loop pass is 100 fake seconds instead of 20, so the limits are checked to within 100 seconds.
function runReview(mode, options = {}) {
  const step = reviewStep('Run Jules review');
  return runWorkflowStep(step.run, { sleepScale: 5, ...options, env: stepEnv(step, mode === 'deep' ? DEEP : FAST) });
}

test('a fast review stops waiting for a silent Jules after about 30 minutes and says so', () => {
  const result = runReview('fast');
  assert.equal(result.status, 0, result.stderr);
  // Fast reviews mostly take 8 to 15 minutes and the slowest of 82 to finish took 24, so the wait must not be cut much shorter.
  assert.ok(result.secondsWaited >= 25 * MINUTE, `gave up after only ${result.secondsWaited}s`);
  assert.ok(result.secondsWaited <= 35 * MINUTE, `kept a runner for ${result.secondsWaited}s`);
  const body = result.runnerFile('jules-review.md');
  assert.match(body, /Jules did not finish within the workflow polling window/);
  assert.match(body, /State: `IN_PROGRESS`/);
});

test('a deep review stops waiting for a silent Jules after about an hour and says so', () => {
  const result = runReview('deep');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.secondsWaited >= 45 * MINUTE, `gave up after only ${result.secondsWaited}s`);
  assert.ok(result.secondsWaited <= 75 * MINUTE, `kept a runner for ${result.secondsWaited}s`);
  assert.match(result.runnerFile('jules-review.md'), /Jules did not finish within the workflow polling window/);
});

test('the job timeout leaves room to post the notice after the longest wait, but is no longer six hours', () => {
  const env = reviewStep('Run Jules review').env;
  const longestWait = Math.max(Number(env.JULES_FAST_WAIT_SECONDS), Number(env.JULES_DEEP_WAIT_SECONDS));
  assert.ok(Number.isInteger(longestWait), 'both wait limits must be whole seconds written in the workflow');
  const timeout = workflow.jobs.review['timeout-minutes'];
  assert.ok(timeout * MINUTE >= longestWait + 15 * MINUTE, `${timeout} minutes would cancel the job before it posts`);
  assert.ok(timeout <= 120, `${timeout} minutes lets a stuck job hold a runner for hours`);
});

test('a Jules that refuses new sessions ends the step at once instead of waiting', () => {
  const result = runReview('fast', { julesCreate: 'refuse' });
  assert.notEqual(result.status, 0);
  assert.equal(result.secondsWaited, 0);
  assert.equal(result.runnerFile('jules-review.md'), null);
  assert.equal(reviewStep('Run Jules review')['continue-on-error'], true);
});

test('a Jules review that completes is returned straight away', () => {
  const activities = [{ createTime: '2026-11-11T00:00:00Z', agentMessaged: { agentMessage: '## Verdict\n\nLooks fine.' } }];
  const result = runReview('fast', { julesState: 'COMPLETED', activities });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.secondsWaited, 0);
  assert.match(result.runnerFile('jules-review.md'), /State: `COMPLETED`[\s\S]*Looks fine\./);
});

test('ready transitions cannot cancel an active draft review', () => {
  assert.ok(!workflow.on.pull_request.types.includes('ready_for_review'));
  assert.ok(workflow.on.pull_request.types.includes('converted_to_draft'));
});
