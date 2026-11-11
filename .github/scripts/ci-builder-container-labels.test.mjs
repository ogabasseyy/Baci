import assert from 'node:assert/strict';
import test from 'node:test';
import {
  builderCiContainerLabels,
  builderCiDockerArgs,
} from '../../apps/web/tools/builder-auth/ci-container-labels.mjs';

test('scopes builder fixtures to the current run, attempt, and job', () => {
  assert.deepEqual(
    builderCiContainerLabels({
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'quality-typecheck',
    }),
    [
      'io.baci.builder-ci.run=123',
      'io.baci.builder-ci.attempt=2',
      'io.baci.builder-ci.job=quality-typecheck',
      'io.baci.builder-ci.scope=single',
    ]
  );
  assert.deepEqual(
    builderCiContainerLabels({
      GITHUB_RUN_ID: '../1',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'quality-typecheck',
    }),
    []
  );
  assert.deepEqual(builderCiContainerLabels({}), []);
  assert.deepEqual(
    builderCiContainerLabels({
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'quality-test-web',
    }),
    []
  );
  assert.equal(
    builderCiContainerLabels({
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'quality-test-web',
      BACI_FIXTURE_SCOPE: '3',
    }).at(-1),
    'io.baci.builder-ci.scope=3'
  );
});

test('fails closed for incomplete GitHub Actions identity and allows local fixtures', () => {
  assert.throws(
    () => builderCiDockerArgs({ GITHUB_ACTIONS: 'true' }),
    /identity/
  );
  assert.deepEqual(builderCiDockerArgs({}), []);
  assert.deepEqual(
    builderCiDockerArgs({
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'quality-typecheck',
    }).slice(0, 2),
    ['--label', 'io.baci.builder-ci.run=123']
  );
});
