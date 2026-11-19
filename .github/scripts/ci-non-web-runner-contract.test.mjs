import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';
import { privateRunnerRoute } from './ci-private-runner-contract-utils.mjs';

const workflow = YAML.parse(await readFile('.github/workflows/ci.yml', 'utf8'));
const job = workflow.jobs['quality-test'];

function route(
  {
    privateRepo = true,
    enabled = 'true',
    qualityEnabled = 'true',
    event = 'pull_request',
    head = 'owner/repo',
  } = {},
  field = 'runs-on'
) {
  return privateRunnerRoute(
    workflow,
    'quality-test',
    {
      'github.event.repository.private': privateRepo,
      'vars.BACI_PRIVATE_CI_ENABLED': enabled,
      'vars.BACI_PRIVATE_QUALITY_TEST_ENABLED': qualityEnabled,
      'github.event_name': event,
      'github.event.pull_request.head.repo.full_name': head,
      'github.repository': 'owner/repo',
    },
    field
  );
}

test('non-web tests use Contabo only for explicitly enabled trusted private events', () => {
  assert.deepEqual(route(), ['self-hosted', 'Linux', 'X64', 'baci-private-ci']);
  assert.equal(route({}, 'timeout-minutes'), 60);
  for (const value of [
    { privateRepo: false },
    { privateRepo: null },
    { enabled: '' },
    { enabled: 'false' },
    { qualityEnabled: '' },
    { qualityEnabled: 'false' },
    { head: 'other/fork' },
    { head: '' },
  ]) {
    assert.equal(route(value), 'ubuntu-24.04');
    assert.equal(route(value, 'timeout-minutes'), 45);
  }
  for (const event of ['merge_group', 'pull_request_target', 'issue_comment']) {
    assert.equal(route({ event }), 'ubuntu-24.04');
  }
  for (const event of ['push', 'workflow_dispatch']) {
    assert.deepEqual(route({ event, head: '' }), [
      'self-hosted',
      'Linux',
      'X64',
      'baci-private-ci',
    ]);
  }
});

test('runs scoped cleanup after the PostgreSQL fixture step on a self-hosted runner', () => {
  const shipping = job.steps.findIndex(
    (step) =>
      step.name === 'Verify authenticated shipping recovery in PostgreSQL'
  );
  const cleanup = job.steps.findIndex(
    (step) => step.name === 'Clean shipping PostgreSQL test containers'
  );
  assert.equal(cleanup, shipping + 1);
  assert.equal(job.steps[shipping].id, 'shipping-recovery');
  assert.equal(
    job.steps[cleanup].if,
    "${{ always() && runner.environment == 'self-hosted' && (steps.shipping-recovery.outcome == 'success' || steps.shipping-recovery.outcome == 'failure' || steps.shipping-recovery.outcome == 'cancelled') }}"
  );
  assert.equal(
    job.steps[cleanup].run,
    'node .github/scripts/cleanup-shipping-ci-containers.mjs'
  );
});

test('the job never references repository secrets', () => {
  assert.doesNotMatch(JSON.stringify(job), /\bsecrets\b/);
});

test('routing and cleanup contracts are included in the CI test plan', async () => {
  const entrypoint = await readFile(
    '.github/scripts/resolve-ci-test-plan-config.test.mjs',
    'utf8'
  );
  const filters = YAML.parse(await readFile('.github/filters/ci.yml', 'utf8'));
  for (const name of [
    'ci-non-web-runner-contract.test.mjs',
    'cleanup-shipping-ci-containers.test.mjs',
  ]) {
    assert.ok(entrypoint.includes(`import './${name}';`));
    assert.ok(filters.web.includes(`.github/scripts/${name}`));
  }
  assert.ok(
    entrypoint.includes(
      "import '../../supabase/tests/shipping-ci-container-labels.test.mjs';"
    )
  );
  for (const name of [
    'shipping-ci-container-labels.mjs',
    'shipping-ci-container-labels.test.mjs',
  ]) {
    assert.ok(filters.web.includes(`supabase/tests/${name}`));
  }
  assert.ok(
    filters.web.includes('.github/scripts/cleanup-shipping-ci-containers.mjs')
  );
});
