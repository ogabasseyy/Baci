import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinateRelease } from './coordinate-production-release.mjs';
import { commit, coordinationId, fixture } from './coordinate-production-release.test-fixtures.mjs';

test('coordinates an isolated worker release without calling the retired installer', async () => {
  const setup = fixture({
    updateWorkers: async () => { throw new Error('legacy installer is forbidden'); },
    verifyWorkers: async () => { throw new Error('legacy worker path is forbidden'); },
    readJobs: async () => [
      { name: 'vps-worker-sync', conclusion: 'success' },
      { name: 'deploy-production', conclusion: 'success' },
    ],
  });
  assert.deepEqual(await coordinateRelease(setup.operations, coordinationId), { commit, runId: 42 });
  assert.ok(!setup.calls.includes('updateWorkers'));
  assert.ok(!setup.calls.includes('verifyWorkers'));
});

test('holds the release lock if publication succeeded without a proven worker sync', async () => {
  for (const workerJobs of [[], [{ name: 'vps-worker-sync', conclusion: 'failure' }],
    [{ name: 'vps-worker-sync', conclusion: 'success' }, { name: 'vps-worker-sync', conclusion: 'success' }]]) {
    const setup = fixture({ readJobs: async () => [
      ...workerJobs, { name: 'deploy-production', conclusion: 'success' },
    ] });
    const error = await coordinateRelease(setup.operations, coordinationId).then(
      () => { throw new Error('expected rejection'); },
      rejection => rejection
    );
    assert.match(error.message, /worker sync/);
    assert.equal(error.indeterminateDispatch, true);
  }
});

test('holds the release lock if worker activation may have changed the live worker', async () => {
  for (const workerJob of [
    { name: 'vps-worker-sync', conclusion: 'failure' },
    { name: 'vps-worker-sync', conclusion: 'failure', steps: [
      { name: 'Install and activate the exact worker release', conclusion: 'failure' },
    ] },
    { name: 'vps-worker-sync', conclusion: 'failure', steps: [null] },
  ]) {
    const setup = fixture({ readJobs: async () => [
      workerJob, { name: 'deploy-production', conclusion: 'skipped' },
    ] });
    const error = await coordinateRelease(setup.operations, coordinationId).then(
      () => { throw new Error('expected rejection'); },
      rejection => rejection
    );
    assert.match(error.message, /worker sync/);
    assert.equal(error.indeterminateDispatch, true);
  }
});

test('holds the release lock if the worker job result is missing even when publication skipped', async () => {
  const setup = fixture({ readJobs: async () => [
    { name: 'deploy-production', conclusion: 'skipped' },
  ] });
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /worker sync/);
  assert.equal(error.indeterminateDispatch, true);
});
