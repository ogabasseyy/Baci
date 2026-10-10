import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireReleaseLock, assertLiveDeployment, coordinateRelease, IN_FLIGHT_RUN_STATUSES, releaseLockPath, selectCoordinatedRun } from './coordinate-production-release.mjs';

const commit = 'b'.repeat(40);
const coordinationId = 'test-coordination';

test('dispatch correlation ignores unrelated or previously observed operator runs', () => {
  const expected = { databaseId: 3, event: 'workflow_dispatch', title: 'Coordinated release unique' };
  const prior = { ...expected, databaseId: 1 };
  const unrelated = { ...expected, databaseId: 2, title: 'Coordinated release other' };
  assert.equal(selectCoordinatedRun([prior, unrelated, expected], [prior], 'unique'), expected);
  assert.equal(selectCoordinatedRun([prior, unrelated], [prior], 'unique'), null);
  assert.throws(() => selectCoordinatedRun([expected, { ...expected, databaseId: 4 }], [], 'unique'), /ambiguous/);
});

test('in-flight enumeration covers approval-gated runs', () => {
  assert.deepEqual(
    [...IN_FLIGHT_RUN_STATUSES].sort(),
    ['action_required', 'in_progress', 'pending', 'queued', 'requested', 'waiting']
  );
});

test('a stale lock reports the lock path instead of a raw error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baci-lock-test-'));
  try {
    const lockPath = join(directory, 'baci-production-release.lock');
    acquireReleaseLock(lockPath);
    assert.throws(() => acquireReleaseLock(lockPath), {
      message: `release lock held: ${lockPath}; confirm no release is running, then remove it`,
    });
    assert.throws(
      () => acquireReleaseLock(join(directory, 'missing-parent', 'baci-production-release.lock')),
      /ENOENT/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('release lock resolves relative and absolute shared Git directories', () => {
  assert.equal(releaseLockPath('/repo', '.git'), '/repo/.git/baci-production-release.lock');
  assert.equal(releaseLockPath('/worktree', '/repo/.git'), '/repo/.git/baci-production-release.lock');
  assert.equal(releaseLockPath('/repo/linked', '../.git'), '/repo/.git/baci-production-release.lock');
});

function fixture(overrides = {}) {
  const calls = [];
  const operations = {
    verifyCheckout: async () => commit,
    readMain: async () => commit,
    updateWorkers: async () => {},
    verifyWorkers: async () => {},
    listRuns: async () => [],
    dispatch: async () => {},
    findRun: async () => ({ databaseId: 42, headSha: commit }),
    listCoordinatedRuns: async () => [],
    watchRun: async () => {},
    cancelRun: async () => {},
    readJobs: async () => [{ name: 'deploy-production', conclusion: 'success' }],
    verifyLive: async () => {},
    ...overrides,
  };
  return {
    calls,
    operations: Object.fromEntries(Object.entries(operations).map(([name, operation]) => [
      name,
      async (...args) => {
        calls.push(name);
        return operation(...args);
      },
    ])),
  };
}

test('updates and verifies workers before dispatching the matching release', async () => {
  const setup = fixture();
  assert.deepEqual(await coordinateRelease(setup.operations, coordinationId), { commit, runId: 42 });
  assert.deepEqual(setup.calls, [
    'verifyCheckout', 'readMain', 'listRuns', 'updateWorkers', 'verifyWorkers',
    'readMain', 'listRuns', 'dispatch', 'findRun', 'listCoordinatedRuns', 'watchRun', 'readJobs', 'verifyLive',
  ]);
});

test('an in-flight sibling aborts the release and cancels our run', async () => {
  const setup = fixture({
    listCoordinatedRuns: async () => [{
      databaseId: 43, event: 'workflow_dispatch', headSha: commit,
      status: 'in_progress', title: 'Coordinated release other-id',
    }],
  });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /concurrent coordination detected/);
  assert.equal(setup.calls.at(-1), 'cancelRun');
  assert.ok(!setup.calls.includes('watchRun'));
});

test('an approval-gated sibling aborts the release like any in-flight run', async () => {
  const setup = fixture({
    listCoordinatedRuns: async () => [{
      databaseId: 43, event: 'workflow_dispatch', headSha: commit,
      status: 'action_required', title: 'Coordinated release other-id',
    }],
  });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /concurrent coordination detected/);
  assert.equal(setup.calls.at(-1), 'cancelRun');
});

test('a completed sibling is an earlier release, not a racer', async () => {
  const setup = fixture({
    listCoordinatedRuns: async () => [{
      databaseId: 43, event: 'workflow_dispatch', headSha: commit,
      status: 'completed', title: 'Coordinated release other-id',
    }],
  });
  assert.deepEqual(await coordinateRelease(setup.operations, coordinationId), { commit, runId: 42 });
  assert.ok(!setup.calls.includes('cancelRun'));
});

test('refuses an older checkout before changing workers', async () => {
  const setup = fixture({ readMain: async () => 'c'.repeat(40) });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /main changed/);
  assert.ok(!setup.calls.includes('updateWorkers'));
});

test('refuses a concurrent deployment before changing workers', async () => {
  const setup = fixture({ listRuns: async () => [{ status: 'in_progress' }] });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /in flight/);
  assert.ok(!setup.calls.includes('updateWorkers'));
});

test('never dispatches after failed worker verification', async () => {
  const setup = fixture({ verifyWorkers: async () => { throw new Error('worker failure'); } });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /worker failure/);
  assert.ok(!setup.calls.includes('dispatch'));
});

test('refuses main advancing during worker preparation', async () => {
  let reads = 0;
  const setup = fixture({ readMain: async () => ++reads === 1 ? commit : 'c'.repeat(40) });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /main changed/);
  assert.ok(!setup.calls.includes('dispatch'));
});

test('never watches a dispatch belonging to another commit', async () => {
  const setup = fixture({ findRun: async () => ({ databaseId: 42, headSha: 'c'.repeat(40) }) });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /dispatch commit mismatch/);
  assert.equal(setup.calls.at(-1), 'cancelRun');
  assert.ok(!setup.calls.includes('watchRun'));
});

test('a null dispatch result is actionable, not a TypeError', async () => {
  const setup = fixture({ findRun: async () => null });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /dispatch outcome unknown/);
  assert.ok(!setup.calls.includes('watchRun'));
});

test('a failed mismatch cancel preserves the mismatch error', async () => {
  const setup = fixture({
    findRun: async () => ({ databaseId: 42, headSha: 'c'.repeat(40) }),
    cancelRun: async () => { throw new Error('run already completed'); },
  });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /dispatch commit mismatch/);
  assert.ok(!setup.calls.includes('watchRun'));
});

test('a green workflow with skipped publication is not a release', async () => {
  const setup = fixture({ readJobs: async () => [{ name: 'deploy-production', conclusion: 'skipped' }] });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /publication did not succeed/);
});

test('an indeterminate dispatch is not retried', async () => {
  const setup = fixture({ dispatch: async () => { throw new Error('response lost'); } });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /response lost/);
  assert.equal(setup.calls.filter(name => name === 'dispatch').length, 1);
});

test('refuses a successful workflow whose live alias remains stale', async () => {
  const setup = fixture({ verifyLive: async () => { throw new Error('stale live alias'); } });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /stale live alias/);
});

test('live verification requires matching project, production target, state and SHA', () => {
  const deployment = { projectId: 'baci', meta: { githubCommitSha: commit }, readyState: 'READY', target: 'production' };
  assert.doesNotThrow(() => assertLiveDeployment(deployment, commit, 'baci'));
  for (const change of [
    { projectId: 'other' }, { meta: { githubCommitSha: 'c'.repeat(40) } },
    { readyState: 'ERROR' }, { target: 'preview' },
  ]) {
    assert.throws(() => assertLiveDeployment({ ...deployment, ...change }, commit, 'baci'), /does not match/);
  }
});
