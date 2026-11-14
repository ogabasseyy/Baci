import assert from 'node:assert/strict';
import test from 'node:test';
import { shippingCiContainerLabels } from './shipping-ci-container-labels.mjs';

test('labels CI fixtures with their run, attempt, and job', () => {
  assert.deepEqual(
    shippingCiContainerLabels({
      GITHUB_RUN_ID: '12345',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'quality-test',
    }),
    [
      'io.baci.shipping-ci.run=12345',
      'io.baci.shipping-ci.attempt=2',
      'io.baci.shipping-ci.job=quality-test',
    ]
  );
});

test('does not create cleanup labels for incomplete or malformed CI identifiers', () => {
  for (const env of [
    {},
    { GITHUB_RUN_ID: '12345' },
    {
      GITHUB_RUN_ID: '../1',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'quality-test',
    },
    {
      GITHUB_RUN_ID: '12345',
      GITHUB_RUN_ATTEMPT: '0',
      GITHUB_JOB: 'quality-test',
    },
    { GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'bad job' },
  ]) {
    assert.deepEqual(shippingCiContainerLabels(env), []);
  }
});
