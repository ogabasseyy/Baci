import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';
import { privateRunnerRoute } from './ci-private-runner-contract-utils.mjs';

const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
const job = workflow.jobs.build;

test('only hosted web builds restore the Next.js cache', () => {
  const restore = job.steps.find((step) => step.id === 'next-cache');
  assert.ok(restore);
  for (const [environment, web, plan, expected] of [
    ['github-hosted', 'true', 'full-affected', true],
    ['github-hosted', 'false', 'full-affected', false],
    ['github-hosted', 'true', 'config-smoke', false],
    ['self-hosted', 'true', 'full-affected', false],
    ['', 'true', 'full-affected', false],
  ]) {
    const condition = restore.if
      .replaceAll('runner.environment', JSON.stringify(environment))
      .replaceAll('needs.changes.outputs.web', JSON.stringify(web))
      .replaceAll('needs.changes.outputs.test_plan_mode', JSON.stringify(plan));
    assert.match(condition, /^[\s()'"\w=!&|.\-]+$/);
    assert.equal(Function(`"use strict"; return (${condition});`)(), expected);
  }
});

test('self-hosted builds cannot save the shared Next.js cache', () => {
  const save = job.steps.find(
    (step) => step.name === 'Save Next.js build cache (main branch only)'
  );
  assert.ok(save);
  assert.match(save.if, /runner\.environment\s*==\s*'github-hosted'/);
});

function route(
  {
    privateRepo = true,
    enabled = 'true',
    buildEnabled = 'true',
    event = 'pull_request',
    head = 'owner/repo',
    web = 'true',
    mode = 'full-affected',
  } = {},
  field = 'runs-on'
) {
  return privateRunnerRoute(
    workflow,
    'build',
    {
      'github.event.repository.private': privateRepo,
      'vars.BACI_PRIVATE_CI_ENABLED': enabled,
      'vars.BACI_PRIVATE_BUILD_ENABLED': buildEnabled,
      'github.event_name': event,
      'github.event.pull_request.head.repo.full_name': head,
      'github.repository': 'owner/repo',
      'needs.changes.outputs.web': web,
      'needs.changes.outputs.test_plan_mode': mode,
    },
    field
  );
}

test('no-op builds do not occupy the private runner', () => {
  for (const value of [
    { web: 'false' },
    { web: '' },
    { mode: 'config-smoke' },
  ]) {
    assert.equal(route(value), 'ubuntu-24.04');
    assert.equal(route(value, 'timeout-minutes'), 45);
  }
});

test('build requires private opt-in and trusted non-merge-group source', () => {
  assert.deepEqual(route(), ['self-hosted', 'Linux', 'X64', 'baci-private-ci']);
  assert.deepEqual(
    route({ enabled: 'TRUE', buildEnabled: 'TRUE', head: 'OWNER/REPO' }),
    ['self-hosted', 'Linux', 'X64', 'baci-private-ci']
  );
  assert.equal(route({}, 'timeout-minutes'), 75);
  for (const value of [
    { privateRepo: false },
    { privateRepo: null },
    { enabled: '' },
    { enabled: 'false' },
    { buildEnabled: '' },
    { buildEnabled: 'false' },
    { head: 'other/fork' },
    { head: '' },
    { event: 'merge_group', head: '' },
  ]) {
    assert.equal(route(value), 'ubuntu-24.04');
    assert.equal(route(value, 'timeout-minutes'), 45);
  }
  for (const event of ['push', 'workflow_dispatch']) {
    assert.deepEqual(route({ event, head: '' }), [
      'self-hosted',
      'Linux',
      'X64',
      'baci-private-ci',
    ]);
  }
  for (const event of ['pull_request_target', 'issue_comment']) {
    assert.equal(route({ event }), 'ubuntu-24.04');
  }
});

test('self-hosted build references no configured secrets and never runs hosted SDK deletion', () => {
  assert.doesNotMatch(JSON.stringify(job), /\bsecrets\b/);
  assert.doesNotMatch(JSON.stringify(workflow.env), /\bsecrets\b/);
  const reclaim = job.steps.find(
    (step) => step.name === 'Reclaim unused hosted-runner SDK space'
  );
  assert.match(reclaim.if, /runner\.environment\s*==\s*'github-hosted'/);
  assert.equal(
    reclaim.run,
    'bash .github/scripts/reclaim-hosted-build-space.sh'
  );
  for (const [environment, web, plan, expected] of [
    ['github-hosted', 'true', 'full-affected', true],
    ['github-hosted', 'false', 'full-affected', false],
    ['github-hosted', 'true', 'config-smoke', false],
    ['self-hosted', 'true', 'full-affected', false],
    ['self-hosted', 'false', 'full-affected', false],
    ['self-hosted', 'true', 'config-smoke', false],
    ['', 'true', 'full-affected', false],
  ]) {
    const condition = reclaim.if
      .replaceAll('runner.environment', JSON.stringify(environment))
      .replaceAll('needs.changes.outputs.web', JSON.stringify(web))
      .replaceAll('needs.changes.outputs.test_plan_mode', JSON.stringify(plan));
    assert.match(condition, /^[\s()'"\w=!&|.\-]+$/);
    assert.equal(Function(`"use strict"; return (${condition});`)(), expected);
  }
});

test('SDK cleanup refuses non-hosted runners before invoking sudo', () => {
  const run =
    'sudo() { printf "sudo called\\n"; }; df() { :; }; source .github/scripts/reclaim-hosted-build-space.sh';
  for (const environment of ['github-hosted', 'self-hosted', '']) {
    const result = spawnSync('bash', ['-c', run], {
      encoding: 'utf8',
      env: { ...process.env, RUNNER_ENVIRONMENT: environment },
    });
    assert.equal(result.status === 0, environment === 'github-hosted');
    assert.equal(
      result.stdout.includes('sudo called'),
      environment === 'github-hosted'
    );
  }
});
