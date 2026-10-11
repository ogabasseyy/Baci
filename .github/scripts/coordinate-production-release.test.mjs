import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireReleaseLock, coordinateRelease, IN_FLIGHT_RUN_STATUSES, releaseLockPath, selectCoordinatedRun, selectSiblingCoordinatedRuns } from './coordinate-production-release.mjs';
import { commit, coordinationId, fixture } from './coordinate-production-release.test-fixtures.mjs';

// Publication, jobs-assessment, and live-verification cases live in
// coordinate-publication.test.mjs so both suites stay under 300 lines.
test('dispatch correlation ignores unrelated or previously observed operator runs', () => {
  const expected = { databaseId: 3, event: 'workflow_dispatch', title: 'Coordinated release unique' };
  const prior = { ...expected, databaseId: 1 };
  const unrelated = { ...expected, databaseId: 2, title: 'Coordinated release other' };
  assert.equal(selectCoordinatedRun([prior, unrelated, expected], [prior], 'unique'), expected);
  assert.equal(selectCoordinatedRun([prior, unrelated], [prior], 'unique'), null);
  assert.throws(() => selectCoordinatedRun([expected, { ...expected, databaseId: 4 }], [], 'unique'), /ambiguous/);
  assert.equal(selectCoordinatedRun([expected, { ...expected }], [], 'unique'), expected);
});

test('dispatch correlation ignores same-title runs on other SHAs', () => {
  const commit = 'b'.repeat(40);
  const plant = { databaseId: 7, event: 'workflow_dispatch', title: 'Coordinated release unique', headSha: 'c'.repeat(40) };
  const ours = { ...plant, databaseId: 8, headSha: commit };
  assert.equal(selectCoordinatedRun([plant, ours], [], 'unique', commit), ours);
  assert.equal(selectCoordinatedRun([plant], [], 'unique', commit), null);
  assert.throws(() => selectCoordinatedRun([ours, { ...ours, databaseId: 9 }], [], 'unique', commit), /ambiguous/);
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
      message: `release lock held: ${lockPath}; confirm no release is running on this machine (the lock is local-only and says nothing about other machines), then remove it`,
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

test('updates and verifies workers before dispatching the matching release', async () => {
  const setup = fixture();
  assert.deepEqual(await coordinateRelease(setup.operations, coordinationId), { commit, runId: 42 });
  assert.deepEqual(setup.calls, [
    'verifyCheckout', 'readMain', 'listRuns', 'updateWorkers', 'verifyWorkers',
    'readMain', 'listRuns', 'readMain', 'dispatch', 'findRun', 'listCoordinatedRuns', 'watchRun', 'readJobs', 'verifyLive', 'readMain',
  ]);
});

test('an in-flight sibling aborts the release and cancels our run', async () => {
  const setup = fixture({
    listCoordinatedRuns: async () => [{
      databaseId: 43, event: 'workflow_dispatch', headSha: commit,
      status: 'in_progress', title: 'Coordinated release other-id',
    }],
  });
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /concurrent coordination detected; our-run cancellation accepted/);
  assert.equal(error.indeterminateDispatch, true);
  assert.equal(setup.calls.at(-1), 'cancelRun');
  assert.ok(!setup.calls.includes('watchRun'));
});

test('an approval-gated sibling aborts the release like any in-flight run', async () => {
  const setup = fixture({
    listCoordinatedRuns: async () => [{
      databaseId: 43, event: 'workflow_dispatch', headSha: commit,
      status: 'completed', conclusion: 'action_required', title: 'Coordinated release other-id',
    }],
  });
  await assert.rejects(coordinateRelease(setup.operations, coordinationId), /concurrent coordination detected/);
  assert.equal(setup.calls.at(-1), 'cancelRun');
});

test('an approval-gated conclusion alone does not make a run a sibling', () => {
  const gated = { event: 'workflow_dispatch', status: 'completed', conclusion: 'action_required', title: 'Coordinated release other-id' };
  assert.deepEqual(selectSiblingCoordinatedRuns([{ ...gated, databaseId: 7 }], [{ databaseId: 7 }], 'new-id'), []);
  assert.deepEqual(selectSiblingCoordinatedRuns([{ ...gated, databaseId: 8, event: 'push', title: 'other' }], [], 'new-id'), []);
  assert.deepEqual(selectSiblingCoordinatedRuns([{ ...gated, databaseId: 9 }], [], 'new-id').map(run => run.databaseId), [9]);
});

test('an in-flight sibling on a different SHA aborts the release', async () => {
  const setup = fixture({
    listCoordinatedRuns: async () => [{
      databaseId: 43, event: 'workflow_dispatch', headSha: 'c'.repeat(40),
      status: 'in_progress', title: 'Coordinated release other-id',
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
  for (const runs of [[{ status: 'in_progress' }], [{ status: 'completed', conclusion: 'action_required' }]]) {
    const setup = fixture({ listRuns: async () => runs });
    await assert.rejects(coordinateRelease(setup.operations, coordinationId), /in flight/);
    assert.ok(!setup.calls.includes('updateWorkers'));
  }
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

test('refuses silent success when main advances during the release', async () => {
  let reads = 0;
  const setup = fixture({ readMain: async () => ++reads <= 3 ? commit : 'c'.repeat(40) });
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /behind tip/);
  assert.equal(error.indeterminateDispatch, true);
});

test('an unreadable post-release tip fails closed', async () => {
  let reads = 0;
  const setup = fixture({
    readMain: async () => {
      reads++;
      if (reads <= 3) return commit;
      throw new Error('api flake');
    },
  });
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /api flake/);
  assert.equal(error.indeterminateDispatch, true);
});

test('refuses dispatch when main advances after the baseline', async () => {
  let reads = 0;
  const setup = fixture({ readMain: async () => ++reads <= 2 ? commit : 'c'.repeat(40) });
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /dispatch refused/);
  assert.equal(error.indeterminateDispatch, undefined);
  assert.ok(!setup.calls.includes('dispatch'));
});

test('never watches a dispatch belonging to another commit', async () => {
  const setup = fixture({ findRun: async () => ({ databaseId: 42, headSha: 'c'.repeat(40) }) });
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /dispatch commit mismatch; cancellation accepted/);
  assert.equal(error.indeterminateDispatch, true);
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
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /dispatch commit mismatch; cancellation failed/);
  assert.equal(error.indeterminateDispatch, true);
  assert.ok(!setup.calls.includes('watchRun'));
});

test('a malformed dispatch identity is indeterminate', async () => {
  const setup = fixture({ findRun: async () => ({ databaseId: 'nope', headSha: commit }) });
  const error = await coordinateRelease(setup.operations, coordinationId).then(
    () => { throw new Error('expected rejection'); },
    rejection => rejection
  );
  assert.match(error.message, /invalid dispatch run identity/);
  assert.equal(error.indeterminateDispatch, true);
});

