// Contract: how the workflow files wire review-first CI.
//
// The property that matters most is the first describe block: a job whose check name
// is one of the REQUIRED branch-protection contexts must never be skipped. GitHub counts
// a skipped job as passed, so a skipped "Build" or "Quality Gate" would let a pull
// request merge before Codex has looked at it. (The nudge workflow has its own file.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const launcher = readFileSync(new URL('./launch-stage.sh', import.meta.url), 'utf8');
import { describe, it } from 'node:test';
import YAML from 'yaml';
import { evaluateExpression } from './expression.mjs';
import { REQUIRED_CONTEXTS, browser, ci, pr, read, stage } from './workflow-contract-support.mjs';

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
    const run = launcher;
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
    assert.match(launcher, /git cat-file -e "\$\{BASE_SHA\}\^\{commit\}"/);
    assert.match(launcher, /git archive "\$BASE_SHA" \.github\/scripts\/review-first-ci/);
    // only the pull request that introduces the scripts falls back to its own copy, with a warning
    assert.match(launcher, /the base branch has no review-first scripts yet/);
    assert.doesNotMatch(launcher, /node \.github\/scripts/);
    // a missing base commit fails closed instead of falling back
    assert.match(launcher, /the base commit is not in this checkout/);
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
    assert.equal(job.steps.find((step) => step.id === 'stage_review').run, 'bash .github/scripts/review-first-ci/launch-stage.sh');
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

 it('shares the extracted stage launcher between both workflows', () => {
   for (const workflow of [ci, browser]) {
     const step = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []).find((entry) => entry.id === 'stage_review');
     assert.equal(step.run, 'bash .github/scripts/review-first-ci/launch-stage.sh');
   }
 });
