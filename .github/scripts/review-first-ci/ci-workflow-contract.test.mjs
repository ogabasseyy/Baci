// Contract: how the workflow files wire review-first CI.
//
// The property that matters most is the first describe block: a job whose check name
// is one of the REQUIRED branch-protection contexts must never be skipped. GitHub counts
// a skipped job as passed, so a skipped "Build" or "Quality Gate" would let a pull
// request merge before Codex has looked at it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import YAML from 'yaml';
import { evaluateExpression } from './expression.mjs';

const read = (file) => readFileSync(new URL(`../../workflows/${file}`, import.meta.url), 'utf8');
const ci = YAML.parse(read('ci.yml'));
const browser = YAML.parse(read('checkout-browser.yml'));
const nudge = YAML.parse(read('review-first-ci-nudge.yml'));

const REQUIRED_CONTEXTS = new Set(['Build', 'Quality Gate', 'Semgrep SAST']);
const REPO = 'o/r';
const pr = (overrides = {}) => ({
  'github.event_name': 'pull_request',
  'github.repository': REPO,
  'github.event.pull_request.head.repo.full_name': REPO,
  ...overrides,
});
const stage = (value) => ({ 'needs.changes.outputs.stage': value });

const SCENARIOS = [
  { label: 'push to main', context: { 'github.event_name': 'push', ...stage('full') }, deferred: false },
  { label: 'merge_group', context: { 'github.event_name': 'merge_group', ...stage('full') }, deferred: false },
  { label: 'manual dispatch', context: { 'github.event_name': 'workflow_dispatch', ...stage('full') }, deferred: false },
  { label: 'push even if the stage output were lost', context: { 'github.event_name': 'push' }, deferred: false },
  { label: 'fork pull request', context: pr({ 'github.event.pull_request.head.repo.full_name': 'someone/fork', ...stage('full') }), deferred: false },
  { label: 'same-repo pull request, stage full', context: pr(stage('full')), deferred: false },
  { label: 'same-repo pull request, stage quick', context: pr(stage('quick')), deferred: true },
  { label: 'same-repo pull request, stage output missing (changes failed)', context: pr(stage('')), deferred: true },
  { label: 'same-repo pull request, stage output absent', context: pr(), deferred: true },
  { label: 'same-repo pull request, unexpected stage value', context: pr(stage('FULLER')), deferred: true },
];

describe('a required check name never belongs to a skipped job', () => {
  for (const jobId of ['build', 'quality']) {
    for (const scenario of SCENARIOS) {
      it(`${jobId}: ${scenario.label}`, () => {
        const job = ci.jobs[jobId];
        const name = evaluateExpression(job.name, scenario.context);
        const runs = Boolean(evaluateExpression(job.if ?? 'true', scenario.context));
        assert.equal(runs, !scenario.deferred, `job ${jobId} should ${scenario.deferred ? 'be skipped' : 'run'}`);
        if (scenario.deferred) {
          assert.equal(REQUIRED_CONTEXTS.has(name), false, `a skipped job must not carry the required name, got "${name}"`);
          assert.match(name, /deferred/i);
        } else {
          assert.equal(name, jobId === 'build' ? 'Build' : 'Quality Gate');
        }
        // The invariant itself: required name implies the job runs.
        assert.ok(!REQUIRED_CONTEXTS.has(name) || runs, `${jobId} would be skipped under the required name "${name}"`);
      });
    }
  }

  it('keeps the required names for normal runs (branch protection is untouched)', () => {
    assert.equal(evaluateExpression(ci.jobs.build.name, SCENARIOS[0].context), 'Build');
    assert.equal(evaluateExpression(ci.jobs.quality.name, SCENARIOS[0].context), 'Quality Gate');
    assert.equal(YAML.parse(read('security.yml')).jobs.semgrep?.name ?? 'Semgrep SAST', 'Semgrep SAST');
  });

  it('keeps the deferred jobs on the same runners as before', () => {
    assert.match(String(ci.jobs.build['runs-on']), /baci-private-ci/);
    assert.match(String(ci.jobs.quality['runs-on']), /baci-private-ci/);
  });
});

describe('heavy jobs wait for the full stage, quick jobs do not', () => {
  const facts = {
    'needs.changes.outputs.web': 'true',
    'needs.changes.outputs.mobile_admin': 'true',
    'needs.changes.outputs.mobile_storefront': 'true',
    'needs.changes.outputs.quiz_db': 'true',
    'needs.changes.outputs.cwv_runner': 'true',
    'needs.changes.outputs.deploy_scripts': 'true',
    'needs.changes.outputs.piggyvest_runbook': 'true',
    'needs.changes.outputs.test_plan_mode': 'full-affected',
    'github.event_name': 'pull_request',
  };
  const HEAVY = ['cwv-runner-contracts', 'quality-test', 'quality-test-web', 'quality-db-replay', 'quality-disposable-sql'];
  const QUICK = ['quality-lint', 'quality-typecheck', 'quality-misc', 'silent-revert-guard'];

  for (const jobId of HEAVY) {
    it(`${jobId} runs only in the full stage`, () => {
      const run = (value) => Boolean(evaluateExpression(ci.jobs[jobId].if, { ...facts, ...stage(value) }));
      assert.equal(run('full'), true);
      assert.equal(run('quick'), false);
      assert.equal(run(''), false);
    });
  }

  for (const jobId of QUICK) {
    it(`${jobId} runs in the quick stage`, () => {
      assert.equal(Boolean(evaluateExpression(ci.jobs[jobId].if, { ...facts, ...stage('quick') })), true);
    });
  }

  it('mobile admin guardrails run in every stage (no job-level condition)', () => {
    assert.equal(ci.jobs['mobile-quality'].if, undefined);
  });

  it('the production approval job stays push / merge_group only', () => {
    assert.match(ci.jobs['quality-quiz-approval'].if, /merge_group/);
    assert.doesNotMatch(ci.jobs['quality-quiz-approval'].if, /stage/);
  });

  it('every job that the aggregate waits for exists', () => {
    for (const need of ci.jobs.quality.needs) assert.ok(ci.jobs[need], `missing job ${need}`);
  });
});

describe('the changes job (pinned by the capability-gate contract)', () => {
  const changes = ci.jobs.changes;
  const byId = (id) => changes.steps.find((step) => step.id === id);
  const modes = [undefined, 'off', 'pilot', 'on'];
  const events = [
    { label: 'push', context: { 'github.event_name': 'push' }, reviewable: false },
    { label: 'merge_group', context: { 'github.event_name': 'merge_group' }, reviewable: false },
    { label: 'workflow_dispatch', context: { 'github.event_name': 'workflow_dispatch' }, reviewable: false },
    { label: 'fork PR', context: pr({ 'github.event.pull_request.head.repo.full_name': 'x/fork' }), reviewable: false },
    { label: 'same-repo PR', context: pr(), reviewable: true },
  ];

  it('stays plain: hosted ubuntu-24.04, no job-level if / needs / env / container', () => {
    assert.equal(changes['runs-on'], 'ubuntu-24.04');
    for (const key of ['if', 'needs', 'env', 'container', 'uses', 'continue-on-error']) assert.equal(changes[key], undefined, key);
  });

  it('asks for read-only permissions only', () => {
    assert.deepEqual(changes.permissions, { contents: 'read', issues: 'read', 'pull-requests': 'read' });
  });

  it('exposes the stage', () => {
    assert.match(changes.outputs.stage, /steps\.stage_review\.outputs\.stage/);
    assert.match(changes.outputs.stage, /steps\.stage_full\.outputs\.stage/);
  });

  for (const event of events) {
    for (const mode of modes) {
      it(`exactly one stage step runs: ${event.label}, switch ${JSON.stringify(mode)}`, () => {
        const context = { ...event.context, 'vars.BACI_REVIEW_FIRST_CI': mode };
        const review = Boolean(evaluateExpression(byId('stage_review').if, context));
        const full = Boolean(evaluateExpression(byId('stage_full').if, context));
        assert.notEqual(review, full);
        assert.equal(review, event.reviewable && (mode === 'on' || mode === 'pilot'));
      });
    }
  }

  it('runs the resolver only through the fail-closed wrapper', () => {
    const run = byId('stage_review').run;
    assert.match(run, /node "\$entry"/);
    assert.match(run, /stage=quick/);
    assert.equal(byId('stage_review').env.GITHUB_TOKEN, '${{ github.token }}');
    assert.match(byId('stage_full').run, /stage=full/);
    assert.doesNotMatch(byId('stage_full').run, /\bnode\b/);
  });

  it('runs the BASE branch copy of the gate scripts, so a pull request cannot edit its own gate', () => {
    const step = byId('stage_review');
    assert.equal(step.env.BASE_SHA, '${{ github.event.pull_request.base.sha }}');
    // the base commit must be there, then the scripts are taken from it (git archive), not from the checkout
    assert.match(step.run, /git cat-file -e "\$\{BASE_SHA\}\^\{commit\}"/);
    assert.match(step.run, /git archive "\$BASE_SHA" \.github\/scripts\/review-first-ci/);
    // only the pull request that introduces the scripts falls back to its own copy, with a warning
    assert.match(step.run, /the base branch has no review-first scripts yet/);
    assert.doesNotMatch(step.run, /node \.github\/scripts/);
    // a missing base commit fails closed instead of falling back
    assert.match(step.run, /the base commit is not in this checkout/);
  });

  it('runs the stage step after the capability gate (no PR-controlled script before it)', () => {
    const gate = changes.steps.findIndex((step) => step.uses === './.github/actions/capability-gate');
    assert.ok(gate > 0);
    assert.ok(changes.steps.indexOf(byId('stage_review')) > gate);
  });
});

describe('triggers of the CI workflow are not narrowed (capability-gate contract)', () => {
  it('keeps push to main, pull_request, merge_group and workflow_dispatch unfiltered', () => {
    assert.deepEqual(ci.on.push, { branches: ['main'] });
    assert.deepEqual(ci.on.pull_request, { branches: ['main'] });
    assert.equal(ci.on.merge_group, null);
    assert.ok('workflow_dispatch' in ci.on);
  });
});

describe('checkout browser regression follows the same stage', () => {
  it('has a stage job built like the one in ci.yml', () => {
    const job = browser.jobs.stage;
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.deepEqual(job.permissions, { contents: 'read', issues: 'read', 'pull-requests': 'read' });
    assert.deepEqual(job.steps.map((step) => step.id).filter(Boolean), ['stage_full', 'stage_review']);
    assert.match(job.steps.find((step) => step.id === 'stage_review').run, /resolve-stage\.mjs/);
  });

  it('decides the stage with exactly the same base-owned script step as ci.yml', () => {
    const fromCi = ci.jobs.changes.steps.find((step) => step.id === 'stage_review');
    const fromBrowser = browser.jobs.stage.steps.find((step) => step.id === 'stage_review');
    assert.equal(fromBrowser.run, fromCi.run);
    assert.deepEqual(fromBrowser.env, fromCi.env);
    assert.equal(fromBrowser.if, fromCi.if);
    const checkout = browser.jobs.stage.steps.find((step) => String(step.uses).startsWith('actions/checkout@'));
    assert.equal(checkout.with['fetch-depth'], 0, 'the base commit must be in the checkout for git archive');
  });

  it('only runs the browser job in the full stage', () => {
    const job = browser.jobs['checkout-browser'];
    assert.deepEqual(job.needs, ['stage']);
    assert.equal(Boolean(evaluateExpression(job.if, { 'needs.stage.outputs.stage': 'full' })), true);
    assert.equal(Boolean(evaluateExpression(job.if, { 'needs.stage.outputs.stage': 'quick' })), false);
    assert.equal(Boolean(evaluateExpression(job.if, {})), false);
  });

  it('keeps its triggers', () => {
    assert.deepEqual(Object.keys(browser.on).sort(), ['merge_group', 'pull_request', 'push', 'workflow_dispatch']);
  });
});

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
    // Both workflows have a deferred full stage, so a finished run of either one can need a nudge.
    assert.deepEqual(nudge.on.workflow_run.workflows, ['CI Quality Gate', 'Checkout browser regression']);
    assert.equal(ci.name, 'CI Quality Gate');
    assert.equal(browser.name, 'Checkout browser regression');
    assert.deepEqual(nudge.on.pull_request_target.types, ['labeled']);
  });

  it('does nothing while the switch is off', () => {
    assert.equal(run({ 'github.event_name': 'schedule', 'vars.BACI_REVIEW_FIRST_CI': undefined }), false);
    assert.equal(run({ 'github.event_name': 'schedule' }), true);
    assert.equal(run({ 'github.event_name': 'schedule', 'vars.BACI_REVIEW_FIRST_CI': 'pilot' }), true);
  });

  it('wakes up for Codex comments on pull requests only', () => {
    assert.equal(run(comment('chatgpt-codex-connector[bot]', 'x')), true);
    assert.equal(run(comment('chatgpt-codex-connector[bot]', 'x', 'NONE', false)), false);
    assert.equal(run(comment('github-actions[bot]', 'Muse review')), false);
    assert.equal(run(comment('ogabasseyy', 'looks good')), false);
  });

  it('accepts /ci-now only from the owner, members and collaborators', () => {
    assert.equal(run(comment('ogabasseyy', '/ci-now', 'OWNER')), true);
    assert.equal(run(comment('someone', '/ci-now', 'COLLABORATOR')), true);
    assert.equal(run(comment('someone', '/ci-now', 'NONE')), false);
    assert.equal(run(comment('someone', '/ci-now', 'CONTRIBUTOR')), false);
  });

  it('wakes up for the break-glass and pilot labels only', () => {
    const label = (name) => ({ 'github.event_name': 'pull_request_target', 'github.event.label.name': name });
    assert.equal(run(label('ci-now')), true);
    assert.equal(run(label('review-first-ci')), true);
    assert.equal(run(label('bug')), false);
  });

  it('wakes up when a pull request run finishes successfully', () => {
    const finished = (event, conclusion) => ({ 'github.event_name': 'workflow_run', 'github.event.workflow_run.event': event, 'github.event.workflow_run.conclusion': conclusion });
    assert.equal(run(finished('pull_request', 'success')), true);
    assert.equal(run(finished('pull_request', 'failure')), false);
    assert.equal(run(finished('push', 'success')), false);
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
