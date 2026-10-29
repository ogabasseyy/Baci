import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runWorkerReleaseCoordinator } from './worker-release-coordinator.mjs';

const identity = { runId: '1234', runAttempt: 2, sha: 'a'.repeat(40) };
const env = { GITHUB_RUN_ID: identity.runId, GITHUB_RUN_ATTEMPT: '2', BACI_EXPECTED_APP_SHA: identity.sha };
const lock = { run_id: identity.runId, run_attempt: identity.runAttempt, sha: identity.sha, state: 'worker_syncing' };
const stage = { ok: true, operation: 'stage', sourceSha: identity.sha, entryCount: 10 };
const preflight = { ok: true, operation: 'preflight', sourceSha: identity.sha, entryCount: 10 };
const promoted = { ok: true, operation: 'promote', sourceSha: identity.sha, previousSha: 'b'.repeat(40), runId: '1234', runAttempt: 2, jobId: '5678' };
const health = { ok: true, operation: 'health', sourceSha: identity.sha, healthy: true, runId: '1234', runAttempt: 2, jobId: '5678' };
const rollback = { ok: true, operation: 'rollback', sourceSha: 'b'.repeat(40), rolledBackSha: identity.sha, runId: '1234', runAttempt: 2, jobId: '5678' };

function mockBroker({ healthResult = health, failAt } = {}) {
  const calls = [];
  return {
    calls,
    broker: {
      async stageWorkerRelease(args) { calls.push(['stage', args]); if (failAt === 'stage') throw Error('stage failed'); return stage; },
      async preflightWorkerRelease(args) { calls.push(['preflight', args]); if (failAt === 'preflight') throw Error('preflight failed'); return preflight; },
      async operateWorkerRelease(args) {
        calls.push([args.operation, args]);
        if (failAt === args.operation) throw Error(`${args.operation} failed`);
        if (args.operation === 'promote') return promoted;
        if (args.operation === 'health') return healthResult;
        return rollback;
      },
    },
  };
}

test('requires an exact durable lock before contacting the broker', async () => {
  for (const current of [null, { ...lock, sha: 'c'.repeat(40) }, { ...lock, state: 'publishing' }]) {
    const { broker, calls } = mockBroker();
    await assert.rejects(runWorkerReleaseCoordinator({ env, broker, readLock: () => current }), /persistent production release lock/);
    assert.deepEqual(calls, []);
  }
});

test('runs the authenticated broker lifecycle in order and requires exact installed SHA health', async () => {
  const { broker, calls } = mockBroker();
  const result = await runWorkerReleaseCoordinator({ env, broker, readLock: () => lock });
  assert.deepEqual(calls.map(([operation]) => operation), ['stage', 'preflight', 'promote', 'health']);
  assert.ok(calls.every(([, args]) => args.sha === identity.sha));
  assert.equal(result.health.sourceSha, identity.sha);
});

test('stage, preflight, and ambiguous promote failures stop without later operations', async () => {
  for (const failed of ['stage', 'preflight', 'promote']) {
    const { broker, calls } = mockBroker({ failAt: failed });
    await assert.rejects(runWorkerReleaseCoordinator({ env, broker, readLock: () => lock }), new RegExp(`${failed} failed`));
    assert.equal(calls.some(([operation]) => operation === 'health' || operation === 'rollback'), false);
  }
});

test('a bad active SHA health receipt requests only a fenced rollback and retains the lock', async () => {
  const { broker, calls } = mockBroker({ healthResult: { ...health, sourceSha: 'c'.repeat(40) } });
  await assert.rejects(
    runWorkerReleaseCoordinator({ env, broker, readLock: () => lock }),
    error => /rollback completed and release lock remains held/.test(error.message) && error.cause?.message.includes('installed SHA'),
  );
  assert.deepEqual(calls.map(([operation]) => operation), ['stage', 'preflight', 'promote', 'health', 'rollback']);
});

test('an invalid rollback receipt leaves release reconciliation blocked', async () => {
  const { broker } = mockBroker({ healthResult: { ok: false, operation: 'health', sourceSha: identity.sha, healthy: false, runId: '1234', runAttempt: 2, jobId: '5678' } });
  broker.operateWorkerRelease = async args => args.operation === 'promote' ? promoted : { ...rollback, sourceSha: 'c'.repeat(40) };
  await assert.rejects(
    runWorkerReleaseCoordinator({ env, broker, readLock: () => lock }),
    error => /rollback is unconfirmed/.test(error.message) && /rollback receipt is invalid/.test(error.rollbackError?.message ?? ''),
  );
});

test('rejects invalid run identity before any lock or broker activity', async () => {
  const { broker, calls } = mockBroker();
  await assert.rejects(runWorkerReleaseCoordinator({ env: { ...env, GITHUB_RUN_ATTEMPT: '0' }, broker, readLock: () => lock }), /identity is invalid/);
  assert.deepEqual(calls, []);
});

test('CLI invocation without injected options fails closed on missing identity', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./worker-release-coordinator.mjs', import.meta.url))],
    { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /worker release coordinator identity is invalid/);
  assert.doesNotMatch(result.stderr, /Cannot read properties of undefined/);
});
