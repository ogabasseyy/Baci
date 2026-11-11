// Contract: the Review-first CI nudge workflow (which events wake it, what it may touch).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateExpression } from './expression.mjs';
import { browser, ci, nudge, read } from './workflow-contract-support.mjs';

describe('the nudge workflow', () => {
  const job = nudge.jobs.nudge;
  const run = (context) => Boolean(evaluateExpression(job.if, { 'vars.BACI_REVIEW_FIRST_CI': 'on', ...context }));
  const comment = (login, body, association = 'NONE', isPullRequest = true) => ({
    'github.event_name': 'issue_comment',
    'github.event.issue.pull_request': isPullRequest ? 'x' : null,
    'github.event.comment.user.login': login,
    'github.event.comment.body': body,
    'github.event.comment.author_association': association,
  });

  it('listens to exactly the events it handles', () => {
    assert.deepEqual(Object.keys(nudge.on).sort(), ['issue_comment', 'pull_request_target', 'schedule', 'workflow_dispatch', 'workflow_run']);
    // The CI run finishing is the signal; the browser regression is picked up by the same nudge and by the sweep.
    assert.deepEqual(nudge.on.workflow_run.workflows, ['CI Quality Gate']);
    assert.equal(ci.name, 'CI Quality Gate');
    assert.deepEqual(nudge.on.pull_request_target.types, ['labeled', 'ready_for_review']);
    assert.deepEqual(nudge.on.schedule, [{ cron: '7,22,37,52 * * * *' }]);
  });

  it('does nothing while the switch is off', () => {
    assert.equal(run({ 'github.event_name': 'schedule', 'vars.BACI_REVIEW_FIRST_CI': undefined }), false);
    assert.equal(run({ 'github.event_name': 'schedule' }), true);
    assert.equal(run({ 'github.event_name': 'schedule', 'vars.BACI_REVIEW_FIRST_CI': 'pilot' }), true);
  });

  it('wakes up for Codex comments on pull requests only', () => {
    assert.equal(run(comment('chatgpt-codex-connector[bot]', '"status":"completed"')), true);
    assert.equal(run(comment('chatgpt-codex-connector[bot]', '"status":"completed"', 'NONE', false)), false);
    assert.equal(run(comment('github-actions[bot]', 'Muse review')), false);
    assert.equal(run(comment('ogabasseyy', 'looks good')), false);
  });

  it('accepts /ci-now only from the owner, members and collaborators', () => {
    assert.equal(run(comment('ogabasseyy', '/ci-now', 'OWNER')), true);
    assert.equal(run(comment('someone', '/ci-now', 'COLLABORATOR')), true);
    assert.equal(run(comment('someone', '/ci-now', 'NONE')), false);
    assert.equal(run(comment('someone', '/ci-now', 'CONTRIBUTOR')), false);
  });

  it('wakes up for the break-glass and pilot labels and for a draft marked ready, nothing else', () => {
    const label = (name) => ({ 'github.event_name': 'pull_request_target', 'github.event.action': 'labeled', 'github.event.label.name': name });
    assert.equal(run(label('ci-now')), true);
    assert.equal(run(label('review-first-ci')), true);
    assert.equal(run(label('bug')), false);
    assert.equal(run({ 'github.event_name': 'pull_request_target', 'github.event.action': 'ready_for_review' }), true);
  });

  it('wakes up when the first pass of a CI run finishes successfully (the re-run pass needs no nudge)', () => {
    const finished = (event, conclusion, attempt = 1) => ({ 'github.event_name': 'workflow_run', 'github.event.workflow_run.event': event, 'github.event.workflow_run.conclusion': conclusion, 'github.event.workflow_run.run_attempt': attempt });
    assert.equal(run(finished('pull_request', 'success')), true);
    assert.equal(run(finished('pull_request', 'failure')), false);
    assert.equal(run(finished('push', 'success')), false);
    assert.equal(run(finished('pull_request', 'success', 2)), false);
  });

  it('only wakes up for Codex comments that can change the verdict (a finished review or a clean receipt)', () => {
    const body = (text) => comment('chatgpt-codex-connector[bot]', text);
    assert.equal(run(body('<!-- x --> {"status":"completed"} -->')), true);
    assert.equal(run(body("Codex Review: Didn't find any major issues.")), true);
    assert.equal(run(body('<!-- x --> {"status":"running"} -->')), false);
  });

  it('never runs pull-request code and only gets the permissions it needs', () => {
    assert.deepEqual(job.permissions, { actions: 'write', contents: 'read', issues: 'write', 'pull-requests': 'read', statuses: 'write' });
    assert.equal(nudge.permissions && Object.keys(nudge.permissions).length, 0);
    const checkout = job.steps.find((step) => String(step.uses).startsWith('actions/checkout@'));
    assert.match(checkout.uses, /@[0-9a-f]{40}/);
    assert.equal(checkout.with.ref, undefined);
    assert.equal(checkout.with['persist-credentials'], false);
    assert.equal(checkout.with['sparse-checkout'], '.github/scripts/review-first-ci');
    const text = read('review-first-ci-nudge.yml');
    assert.doesNotMatch(text, /github\.event\.pull_request\.head/);
    assert.doesNotMatch(text, /github\.head_ref/);
    assert.doesNotMatch(text, /\$\{\{\s*github\.event\.(comment|issue)\.(body|title)/);
  });

  it('serialises work per pull request and runs the nudge script', () => {
    assert.match(nudge.concurrency.group, /review-first-ci-nudge/);
    assert.equal(nudge.concurrency['cancel-in-progress'], false);
    const step = job.steps.find((candidate) => candidate.run?.includes('nudge-cli.mjs'));
    assert.ok(step);
    assert.equal(step.env.GITHUB_TOKEN, '${{ github.token }}');
  });
});
