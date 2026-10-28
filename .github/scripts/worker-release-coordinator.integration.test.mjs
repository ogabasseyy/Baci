import assert from 'node:assert/strict';
import test from 'node:test';
import { runTestOnlyWorkerReleaseCoordinator } from './worker-release-coordinator.integration.mjs';

const identity = { runId: '1234', runAttempt: 2, sha: 'a'.repeat(40) };
const env = { NODE_ENV: 'test', BACI_ENABLE_TEST_ONLY_WORKER_COORDINATOR: '1' };
const matchingLock = {
  run_id: identity.runId, run_attempt: identity.runAttempt, sha: identity.sha, state: 'worker_syncing',
};
const stage = { ok: true, operation: 'stage', sourceSha: identity.sha, entryCount: 10 };
const preflight = { ok: true, operation: 'preflight', sourceSha: identity.sha, entryCount: 10 };
const promoted = { ok: true, operation: 'promote', sourceSha: identity.sha, previousSha: 'b'.repeat(40), runId: '1234', runAttempt: 2, jobId: '5678' };
const health = { ok: true, operation: 'health', sourceSha: identity.sha, healthy: true, runId: '1234', runAttempt: 2, jobId: '5678' };
const rollback = { ok: true, operation: 'rollback', sourceSha: 'b'.repeat(40), rolledBackSha: identity.sha, runId: '1234', runAttempt: 2, jobId: '5678' };

function mockBroker({ promoteResult = promoted, healthResult = health, rollbackResult = rollback, failAt } = {}) {
  const calls = [];
  const broker = {
    async stageWorkerRelease(args) {
      calls.push(['stage', args]);
      if (failAt === 'stage') throw new Error('stage failed');
      return stage;
    },
    async preflightWorkerRelease(args) {
      calls.push(['preflight', args]);
      if (failAt === 'preflight') throw new Error('preflight failed');
      return preflight;
    },
    async operateWorkerRelease(args) {
      calls.push([args.operation, args]);
      if (failAt === args.operation) throw new Error(`${args.operation} failed`);
      if (args.operation === 'promote') return promoteResult;
      if (args.operation === 'health') return healthResult;
      return rollbackResult;
    },
  };
  return { calls, broker };
}

test('coordinator is disabled unless both test-only gates are explicit', async () => {
  const { broker, calls } = mockBroker();
  await assert.rejects(runTestOnlyWorkerReleaseCoordinator({ identity, env: { NODE_ENV: 'production' }, broker }), /disabled/);
  await assert.rejects(runTestOnlyWorkerReleaseCoordinator({ identity, env: { NODE_ENV: 'test' }, broker }), /disabled/);
  assert.deepEqual(calls, []);
});

test('verifies existing persistent lock and runs stage, preflight, promote, health in order', async () => {
  const { broker, calls } = mockBroker();
  let lockReads = 0;
  const result = await runTestOnlyWorkerReleaseCoordinator({
    identity, env, lockPath: '/mock/persistent-lock', broker,
    readLock: path => { lockReads += 1; assert.equal(path, '/mock/persistent-lock'); return matchingLock; },
  });
  assert.deepEqual(calls.map(([name]) => name), ['stage', 'preflight', 'promote', 'health']);
  assert.equal(lockReads, 1);
  assert.deepEqual(Object.keys(result), ['staged', 'preflight', 'promoted', 'health']);
  assert.ok(calls.every(([, args]) => args.sha === identity.sha));
});

test('refuses missing, stale, or publishing locks before contacting the broker', async () => {
  for (const lock of [null, { ...matchingLock, sha: 'c'.repeat(40) }, { ...matchingLock, state: 'publishing' }]) {
    const { broker, calls } = mockBroker();
    await assert.rejects(runTestOnlyWorkerReleaseCoordinator({ identity, env, broker, readLock: () => lock }), /persistent production release lock/);
    assert.deepEqual(calls, []);
  }
});

test('stage and preflight failures stop before promotion and leave lock untouched', async () => {
  for (const failAt of ['stage', 'preflight']) {
    const { broker, calls } = mockBroker({ failAt });
    await assert.rejects(runTestOnlyWorkerReleaseCoordinator({ identity, env, broker, readLock: () => matchingLock }), new RegExp(`${failAt} failed`));
    assert.equal(calls.some(([name]) => name === 'promote'), false);
  }
});

test('ambiguous promote failure is never followed by health or automatic rollback', async () => {
  const { broker, calls } = mockBroker({ failAt: 'promote' });
  await assert.rejects(runTestOnlyWorkerReleaseCoordinator({ identity, env, broker, readLock: () => matchingLock }), /promote failed/);
  assert.deepEqual(calls.map(([name]) => name), ['stage', 'preflight', 'promote']);
});

test('rejects a promote receipt from a different run before health or rollback', async () => {
  const { broker, calls } = mockBroker({ promoteResult: { ...promoted, runId: '9999' } });
  await assert.rejects(
    runTestOnlyWorkerReleaseCoordinator({ identity, env, broker, readLock: () => matchingLock }),
    /promote receipt is invalid/,
  );
  assert.deepEqual(calls.map(([name]) => name), ['stage', 'preflight', 'promote']);
});

test('rejects health receipts whose run or job differs from the promotion receipt', async () => {
  for (const healthResult of [
    { ...health, runAttempt: 1 },
    { ...health, jobId: '9999' },
  ]) {
    const { broker, calls } = mockBroker({ healthResult });
    await assert.rejects(
      runTestOnlyWorkerReleaseCoordinator({ identity, env, broker, readLock: () => matchingLock }),
      error => /rollback completed/.test(error.message) && error.cause?.message === 'worker release health receipt is invalid',
    );
    assert.deepEqual(calls.map(([name]) => name), ['stage', 'preflight', 'promote', 'health', 'rollback']);
  }
});

test('health failure requests only the fenced broker rollback and preserves the persistent lock', async () => {
  const { broker, calls } = mockBroker({ healthResult: { ok: false } });
  await assert.rejects(
    runTestOnlyWorkerReleaseCoordinator({ identity, env, broker, readLock: () => matchingLock }),
    error => /rollback completed and release lock remains held/.test(error.message) && error.rollbackReceipt.rolledBackSha === identity.sha,
  );
  assert.deepEqual(calls.map(([name]) => name), ['stage', 'preflight', 'promote', 'health', 'rollback']);
});

test('unconfirmed rollback keeps the release blocked and reports reconciliation', async () => {
  const { broker, calls } = mockBroker({ healthResult: { ok: false }, failAt: 'rollback' });
  await assert.rejects(
    runTestOnlyWorkerReleaseCoordinator({ identity, env, broker, readLock: () => matchingLock }),
    error => /rollback is unconfirmed; persistent release lock remains held/.test(error.message) && error.rollbackError.message === 'rollback failed',
  );
  assert.deepEqual(calls.map(([name]) => name), ['stage', 'preflight', 'promote', 'health', 'rollback']);
});

test('does not report rollback complete when its run or restored target mismatches promotion', async () => {
  for (const rollbackResult of [
    { ...rollback, runId: '9999' },
    { ...rollback, sourceSha: 'c'.repeat(40) },
  ]) {
    const { broker } = mockBroker({ healthResult: { ok: false }, rollbackResult });
    await assert.rejects(
      runTestOnlyWorkerReleaseCoordinator({ identity, env, broker, readLock: () => matchingLock }),
      error => /rollback is unconfirmed/.test(error.message) && /rollback receipt is invalid/.test(error.rollbackError?.message ?? ''),
    );
  }
});
