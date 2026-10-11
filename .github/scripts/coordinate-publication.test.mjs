import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertLiveDeployment, coordinateRelease, DEPLOY_PROMOTE_STEP_NAME } from './coordinate-production-release.mjs';
import { commit, coordinationId, fixture } from './coordinate-production-release.test-fixtures.mjs';
import { runWorkerDeploy, WORKER_UNRECONCILED_EXIT } from './release-subprocess.mjs';

// Split from coordinate-production-release.test.mjs: publication,
// jobs-assessment, and live-verification cases live here so both
// suites stay under the 300-line limit.
test('a green workflow with skipped publication is not a release', async () => {
  const setup = fixture({ readJobs: async () => [{ name: 'deploy-production', conclusion: 'skipped' }] });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /publication did not succeed/);
});

test('an indeterminate dispatch is not retried', async () => {
  const setup = fixture({ dispatch: async () => { throw new Error('response lost'); } });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /response lost/);
  assert.equal(setup.calls.filter(name => name === 'dispatch').length, 1);
});

test('malformed job listings hold the lock instead of throwing TypeError', async () => {
  for (const readJobs of [
    async () => null,
    async () => ({ message: 'error' }),
    async () => [null],
    async () => [{ name: 'deploy-production' }],
    async () => [{ name: 'deploy-production', conclusion: 'success' }, null],
  ]) {
    const setup = fixture({ readJobs });
    const error = await coordinateRelease(setup.operations, coordinationId).then(
      () => { throw new Error('expected rejection'); },
      rejection => rejection
    );
    assert.match(error.message, /publication state unreadable/);
    assert.equal(error.indeterminateDispatch, true);
  }
});

test('tags dispatch-window failures as indeterminate dispatches', async () => {
  const cases = [
    fixture({ dispatch: async () => { throw new Error('response lost'); } }),
    fixture({ findRun: async () => { throw new Error('dispatch outcome unknown'); } }),
    fixture({ findRun: async () => null }),
    fixture({ listCoordinatedRuns: async () => { throw new Error('api flake'); } }),
    fixture({ watchRun: async () => { throw new Error('watch flake'); } }),
    fixture({ readJobs: async () => { throw new Error('jobs flake'); } }),
  ];
  for (const setup of cases) {
    const error = await coordinateRelease(setup.operations, coordinationId).then(
      () => { throw new Error('expected rejection'); },
      rejection => rejection
    );
    assert.equal(error.indeterminateDispatch, true);
  }
  const abortSetup = fixture({
    listCoordinatedRuns: async () => [{
      databaseId: 43, event: 'workflow_dispatch', headSha: commit,
      status: 'in_progress', title: 'Coordinated release other-id',
    }],
    cancelRun: async () => { throw new Error('cancel flake'); },
  });
  const abortError = await coordinateRelease(abortSetup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(abortError.message, /concurrent coordination detected; our-run cancellation failed/);
  assert.equal(abortError.indeterminateDispatch, true);
  // verifyLive failures tag indeterminate too — covered with the flag
  // assertion in 'refuses a successful workflow whose live alias
  // remains stale' below.
});

test('a post-promotion job failure holds the lock for reconciliation', async () => {
  const jobs = [{
    name: 'deploy-production',
    conclusion: 'failure',
    steps: [
      { name: DEPLOY_PROMOTE_STEP_NAME, conclusion: 'success' },
      { name: 'Purge and verify storefront release HTML', conclusion: 'failure' },
    ],
  }];
  const setup = fixture({ readJobs: async () => jobs });
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /may have succeeded/);
  assert.equal(error.indeterminateDispatch, true);
});

test('a job that never reached promotion releases the lock for a clean retry', async () => {
  for (const jobs of [
    [{ name: 'deploy-production', conclusion: 'failure', steps: [{ name: DEPLOY_PROMOTE_STEP_NAME, conclusion: 'skipped' }] }],
    [{ name: 'deploy-production', conclusion: 'failure', steps: [{ name: 'Set up job', conclusion: 'success' }] }],
    [{ name: 'deploy-production', conclusion: 'cancelled', steps: [{ name: 'Set up job', conclusion: 'cancelled' }] }],
    [{ name: 'deploy-production', conclusion: 'skipped' }],
  ]) {
    const setup = fixture({ readJobs: async () => jobs });
    const error = await coordinateRelease(setup.operations, coordinationId).then(
      () => { throw new Error('expected rejection'); },
      rejection => rejection
    );
    assert.match(error.message, /publication did not succeed/);
    assert.equal(error.indeterminateDispatch, undefined);
  }
});

test('an ambiguously failed promotion holds the lock', async () => {
  // deploy-with-retry documents ambiguous promote failures: a failed
  // step may still have changed production (unreachable alias lookup,
  // failed overlap recovery), so the lock must hold.
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    const jobs = [{
      name: 'deploy-production',
      conclusion: 'failure',
      steps: [{ name: DEPLOY_PROMOTE_STEP_NAME, conclusion }],
    }];
    const setup = fixture({ readJobs: async () => jobs });
    const error = await coordinateRelease(setup.operations, coordinationId).then(
      () => { throw new Error('expected rejection'); },
      rejection => rejection
    );
    assert.match(error.message, /may have succeeded/);
    assert.equal(error.indeterminateDispatch, true);
  }
});

test('a cancelled run that promoted holds the lock like a failed one', async () => {
  const jobs = [{
    name: 'deploy-production',
    conclusion: 'cancelled',
    steps: [{ name: DEPLOY_PROMOTE_STEP_NAME, conclusion: 'success' }],
  }];
  const setup = fixture({ readJobs: async () => jobs });
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /may have succeeded/);
  assert.equal(error.indeterminateDispatch, true);
});

test('a non-green run with multiple attempts holds the lock', async () => {
  // Attempt 1 may have promoted before attempt 2 failed
  // pre-promotion; the latest jobs alone cannot rule that out.
  const jobs = [{ name: 'deploy-production', conclusion: 'failure', steps: [{ name: 'Set up job', conclusion: 'failure' }] }];
  for (const readAttemptCount of [async () => 2, async () => null, async () => { throw new Error('api flake'); }]) {
    const setup = fixture({ readJobs: async () => jobs, readAttemptCount });
    const error = await coordinateRelease(setup.operations, coordinationId).then(
      () => { throw new Error('expected rejection'); },
      rejection => rejection
    );
    assert.match(error.message, /earlier attempt|api flake/);
    assert.equal(error.indeterminateDispatch, true);
  }
});

test('a single-attempt pre-promotion failure still releases cleanly', async () => {
  const jobs = [{ name: 'deploy-production', conclusion: 'failure', steps: [{ name: 'Set up job', conclusion: 'failure' }] }];
  const setup = fixture({ readJobs: async () => jobs, readAttemptCount: async () => 1 });
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /publication did not succeed/);
  assert.equal(error.indeterminateDispatch, undefined);
});

test('unreadable steps on a non-skipped job fail closed', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    const setup = fixture({ readJobs: async () => [{ name: 'deploy-production', conclusion }] });
    const error = await coordinateRelease(setup.operations, coordinationId).then(
      () => { throw new Error('expected rejection'); },
      rejection => rejection
    );
    assert.match(error.message, /may have succeeded/);
    assert.equal(error.indeterminateDispatch, true);
  }
});

test('the promote-step pin matches the deploy workflow', () => {
  const deploy = readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8');
  assert.ok(deploy.includes(`- name: ${DEPLOY_PROMOTE_STEP_NAME}`), 'deploy.yml must keep the pinned promote step name');
});

test('refuses a successful workflow whose live alias remains stale', async () => {
  const setup = fixture({ verifyLive: async () => { throw new Error('stale live alias'); } });
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /stale live alias/);
  assert.equal(error.indeterminateDispatch, true);
});

test('live verification requires matching project, production target, state and SHA', () => {
  const deployment = { projectId: 'baci', meta: { githubCommitSha: commit }, readyState: 'READY', target: 'production' };
  assert.doesNotThrow(() => assertLiveDeployment(deployment, commit, 'baci'));
  // CLI prebuilt deployments carry gitCommitSha instead of
  // githubCommitSha (verified live on production): accept it.
  assert.doesNotThrow(() => assertLiveDeployment({ ...deployment, meta: { gitCommitSha: commit } }, commit, 'baci'));
  assert.doesNotThrow(() => assertLiveDeployment({ ...deployment, meta: { githubCommitSha: commit, gitCommitSha: commit } }, commit, 'baci'));
  for (const change of [
    { projectId: 'other' }, { meta: { githubCommitSha: 'c'.repeat(40) } },
    { meta: { gitCommitSha: 'c'.repeat(40) } }, { meta: {} },
    { meta: { githubCommitSha: commit, gitCommitSha: 'c'.repeat(40) } },
    { readyState: 'ERROR' }, { target: 'preview' },
  ]) {
    assert.throws(() => assertLiveDeployment({ ...deployment, ...change }, commit, 'baci'), /does not match/);
  }
  for (const malformed of [null, undefined, [], 'READY', 42, { message: 'not found' }]) {
    assert.throws(() => assertLiveDeployment(malformed, commit, 'baci'), /does not match/);
  }
});

test('a rollback-failed worker deploy holds the lock instead of releasing it', async () => {
  const rollbackFailed = Object.assign(
    new Error('bash vps-workers/deploy.sh failed with status 42; inspect preceding diagnostics'),
    { status: WORKER_UNRECONCILED_EXIT },
  );
  try {
    runWorkerDeploy(() => { throw rollbackFailed; });
    assert.fail('worker deploy must throw');
  } catch (error) {
    assert.equal(error.indeterminateDispatch, true);
  }
  const cleanFailure = Object.assign(
    new Error('bash vps-workers/deploy.sh failed with status 1; inspect preceding diagnostics'),
    { status: 1 },
  );
  try {
    runWorkerDeploy(() => { throw cleanFailure; });
    assert.fail('worker deploy must throw');
  } catch (error) {
    assert.equal(error.indeterminateDispatch, undefined);
  }
  const setup = fixture({ updateWorkers: () => runWorkerDeploy(() => { throw rollbackFailed; }) });
  await coordinateRelease(setup.operations, coordinationId).then(
    () => assert.fail('coordinator must throw'),
    error => assert.equal(error.indeterminateDispatch, true),
  );
});
