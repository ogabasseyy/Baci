import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';
import { privateRunnerRoute } from './ci-private-runner-contract-utils.mjs';

const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
const job = workflow.jobs['quality-test-web'];

function route({ privateRepo = true, enabled = 'true', webEnabled = 'true', event = 'pull_request', head = 'owner/repo' } = {}, field = 'runs-on') {
  return privateRunnerRoute(workflow, 'quality-test-web', { 'github.event.repository.private': privateRepo, 'vars.BACI_PRIVATE_CI_ENABLED': enabled, 'vars.BACI_PRIVATE_WEB_TEST_ENABLED': webEnabled, 'github.event_name': event, 'github.event.pull_request.head.repo.full_name': head, 'github.repository': 'owner/repo' }, field);
}

test('web shards require private opt-in and trusted non-merge-group source', () => {
  assert.deepEqual(route(), ['self-hosted', 'Linux', 'X64', 'baci-private-ci']);
  assert.equal(route({}, 'timeout-minutes'), 45);
  for (const value of [{ privateRepo: false }, { privateRepo: null }, { enabled: '' }, { enabled: 'false' }, { webEnabled: '' }, { webEnabled: 'false' }, { head: 'other/fork' }, { head: '' }, { event: 'merge_group', head: '' }]) {
    assert.equal(route(value), 'ubuntu-24.04');
    assert.equal(route(value, 'timeout-minutes'), 25);
  }
  for (const event of ['push', 'workflow_dispatch']) {
    assert.deepEqual(route({ event, head: '' }), ['self-hosted', 'Linux', 'X64', 'baci-private-ci']);
  }
  for (const event of ['pull_request_target', 'issue_comment']) {
    assert.equal(route({ event }), 'ubuntu-24.04');
  }
});

test('web shards do not reference secrets and hydrate their full history', () => {
  const noSecrets = (value) => assert.doesNotMatch(JSON.stringify(value), /\bsecrets\b/);
  assert.throws(() => noSecrets('${{ toJSON(secrets) }}'));
  noSecrets(workflow.env);
  noSecrets(job);
  assert.equal(job.steps[0].with['fetch-depth'], 0);
  assert.equal(job.steps[0].with.filter, '');
  assert.equal(job.steps[0].with['persist-credentials'], false);
  const shard = job.steps.findIndex((step) => step.id === 'web-shard');
  assert.equal(job.steps[shard].run, 'bash .github/scripts/run-ci-web-shard.sh');
  assert.ok(job.steps.findIndex((step) => step.name === 'Clean builder auth test containers') > shard);
  assert.equal(job.env.BACI_FIXTURE_SCOPE, '${{ matrix.shard }}');
});

test('only self-hosted shards receive the four-worker limit', () => {
  for (const environment of ['self-hosted', 'github-hosted']) {
    const result = spawnSync('bash', ['-c', 'pnpm() { printf "%s\\n" "$*"; }; source .github/scripts/run-ci-web-shard.sh'], {
      encoding: 'utf8',
      env: { ...process.env, RUNNER_ENVIRONMENT: environment, VITEST_SHARD: '3' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--shard=3\/6/);
    assert.equal(result.stdout.includes('--maxWorkers=4'), environment === 'self-hosted');
  }
});
