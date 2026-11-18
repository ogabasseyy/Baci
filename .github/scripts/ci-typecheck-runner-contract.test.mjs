import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';
import { privateRunnerRoute } from './ci-private-runner-contract-utils.mjs';

const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
const job = workflow.jobs['quality-typecheck'];

function route({ privateRepo = true, enabled = 'true', typecheckEnabled = 'true', event = 'pull_request', head = 'owner/repo' } = {}, field = 'runs-on') {
  return privateRunnerRoute(workflow, 'quality-typecheck', { 'github.event.repository.private': privateRepo, 'vars.BACI_PRIVATE_CI_ENABLED': enabled, 'vars.BACI_PRIVATE_TYPECHECK_ENABLED': typecheckEnabled, 'github.event_name': event, 'github.event.pull_request.head.repo.full_name': head, 'github.repository': 'owner/repo' }, field);
}

test('typecheck requires explicit private opt-in and trusted repository head', () => {
  assert.deepEqual(route(), ['self-hosted', 'Linux', 'X64', 'baci-private-ci']);
  assert.equal(job['timeout-minutes'], 45);
  for (const value of [{ privateRepo: false }, { privateRepo: null }, { enabled: '' }, { enabled: 'false' }, { typecheckEnabled: '' }, { typecheckEnabled: 'false' }, { head: 'other/fork' }, { head: '' }]) {
    assert.equal(route(value), 'ubuntu-24.04');
  }
  assert.equal(route({ event: 'merge_group', head: '' }), 'ubuntu-24.04');
  for (const event of ['pull_request_target', 'issue_comment']) {
    assert.equal(route({ event }), 'ubuntu-24.04');
  }
  for (const event of ['push', 'workflow_dispatch']) {
    assert.deepEqual(route({ event, head: '' }), ['self-hosted', 'Linux', 'X64', 'baci-private-ci']);
  }
});

test('typecheck job does not reference secrets', () => {
  const noSecrets = (value) => assert.doesNotMatch(JSON.stringify(value), /\bsecrets\b/);
  assert.throws(() => noSecrets('${{ toJSON(secrets) }}'));
  assert.doesNotThrow(() => noSecrets('not_secrets'));
  noSecrets(workflow.env);
  noSecrets(job);
});

test('builder fixture containers are scoped and cleaned after interruption', async () => {
  const configSuite = await readFile('.github/scripts/resolve-ci-test-plan-config.test.mjs', 'utf8');
  const labelSuite = '.github/scripts/ci-builder-container-labels.test.mjs';
  assert.match(configSuite, /import '\.\/ci-builder-container-labels\.test\.mjs'/);
  assert.ok(job.steps.some((step) => typeof step.run === 'string' && step.run.includes(labelSuite)));
  const fixtures = await readFile('apps/web/tools/builder-auth/test-fixtures.ts', 'utf8');
  const api = await readFile('apps/web/tools/builder-auth/data-api.node.test.ts', 'utf8');
  const draftApi = await readFile('apps/web/tools/builder-auth/draft-api-fixture.ts', 'utf8');
  assert.match(fixtures, /\.\.\.builderCiDockerArgs\(\)/);
  assert.match(api, /\.\.\.builderCiDockerArgs\(\)/);
  assert.match(draftApi, /\.\.\.builderCiDockerArgs\(\)/);
  const builder = job.steps.find((step) => step.name === 'Run isolated builder auth tests');
  const cleanup = job.steps.find((step) => step.name === 'Clean builder auth test containers');
  assert.equal(builder.id, 'builder-auth-tests');
  assert.match(cleanup.if, /always\(\)/);
  assert.match(cleanup.if, /self-hosted/);
  assert.match(cleanup.if, /builder-auth-tests/);
  assert.match(cleanup.run, /cleanup-builder-ci-containers\.mjs/);
  for (const [jobId, stepId] of [['quality-test', 'test-execution'], ['quality-test-web', 'web-shard']]) {
    const webJob = workflow.jobs[jobId];
    const webCleanup = webJob.steps.find((step) => step.name === 'Clean builder auth test containers');
    assert.match(webCleanup.if, /always\(\)/);
    assert.match(webCleanup.if, new RegExp(stepId));
    assert.match(webCleanup.run, /cleanup-builder-ci-containers\.mjs/);
  }
  assert.equal(workflow.jobs['quality-test-web'].env.BACI_FIXTURE_SCOPE, '${{ matrix.shard }}');
});
