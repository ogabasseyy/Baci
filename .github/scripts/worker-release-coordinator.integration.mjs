/**
 * Test-only orchestration for the isolated VPS worker release broker.
 * This module is deliberately not imported by production workflows. Enabling
 * it requires both NODE_ENV=test and an explicit test-only environment flag.
 */
import { readProductionReleaseLock, PRODUCTION_RELEASE_LOCK_PATH } from './production-release-lock.mjs';
import {
  operateWorkerRelease,
  preflightWorkerRelease,
  stageWorkerRelease,
} from '../../vps-workers/lib/worker-release-broker-client.mjs';

const ENABLE_FLAG = 'BACI_ENABLE_TEST_ONLY_WORKER_COORDINATOR';

function requireEnabled(env) {
  if (env.NODE_ENV !== 'test' || env[ENABLE_FLAG] !== '1') {
    throw new Error('test-only worker release coordinator is disabled');
  }
}

function assertLockOwner(lock, identity) {
  if (!lock || lock.state !== 'worker_syncing' ||
      lock.run_id !== String(identity.runId) || lock.run_attempt !== identity.runAttempt ||
      lock.sha !== identity.sha) {
    throw new Error('persistent production release lock does not match this worker run');
  }
}

function hasRunReceipt(receipt, identity, expectedJobId) {
  return String(receipt?.runId) === String(identity.runId) &&
    receipt?.runAttempt === identity.runAttempt &&
    /^[1-9][0-9]{0,19}$/.test(String(receipt?.jobId)) &&
    (expectedJobId === undefined || String(receipt.jobId) === String(expectedJobId));
}

/**
 * Exercise the complete authenticated broker lifecycle while an existing
 * production release lock is held. This function never clears or advances
 * that lock; the existing publication/finalizer gates remain authoritative.
 */
export async function runTestOnlyWorkerReleaseCoordinator({
  identity,
  env = process.env,
  lockPath = PRODUCTION_RELEASE_LOCK_PATH,
  readLock = readProductionReleaseLock,
  broker,
}) {
  requireEnabled(env);
  if (!identity || !/^[1-9][0-9]*$/.test(String(identity.runId)) ||
      !Number.isSafeInteger(identity.runAttempt) || identity.runAttempt < 1 ||
      !/^[0-9a-f]{40}$/.test(identity.sha ?? '')) {
    throw new Error('worker release coordinator identity is invalid');
  }
  assertLockOwner(readLock(lockPath), identity);

  const authorizedBroker = broker ?? (() => {
    const credentials = {
      githubToken: env.GH_TOKEN ?? env.GITHUB_TOKEN,
      oidcRequestUrl: env.ACTIONS_ID_TOKEN_REQUEST_URL,
      oidcRequestToken: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    };
    return {
      stageWorkerRelease: options => stageWorkerRelease({ ...credentials, ...options }),
      preflightWorkerRelease: options => preflightWorkerRelease({ ...credentials, ...options }),
      operateWorkerRelease: options => operateWorkerRelease({ ...credentials, ...options }),
    };
  })();

  const common = { sha: identity.sha };
  const staged = await authorizedBroker.stageWorkerRelease({ ...common });
  if (staged?.ok !== true || staged.operation !== 'stage' || staged.sourceSha !== identity.sha ||
      !Number.isSafeInteger(staged.entryCount) || staged.entryCount < 1) {
    throw new Error('worker release stage receipt is invalid');
  }

  const preflight = await authorizedBroker.preflightWorkerRelease({ ...common });
  if (preflight?.ok !== true || preflight.operation !== 'preflight' || preflight.sourceSha !== identity.sha ||
      !Number.isSafeInteger(preflight.entryCount) || preflight.entryCount < 1) {
    throw new Error('worker release preflight receipt is invalid');
  }

  // A failed/ambiguous promote is never followed by an automatic rollback:
  // reconcile the broker's durable release-state fence while the persistent
  // production lock remains held.
  const promoted = await authorizedBroker.operateWorkerRelease({ operation: 'promote', ...common });
  if (promoted?.ok !== true || promoted.operation !== 'promote' || promoted.sourceSha !== identity.sha ||
      !hasRunReceipt(promoted, identity) ||
      (promoted.previousSha !== null && !/^[0-9a-f]{40}$/.test(promoted.previousSha ?? ''))) {
    throw new Error('worker release promote receipt is invalid; persistent release lock remains held');
  }

  try {
    const health = await authorizedBroker.operateWorkerRelease({ operation: 'health', ...common });
    if (health?.ok !== true || health.operation !== 'health' || health.sourceSha !== identity.sha || health.healthy !== true ||
        !hasRunReceipt(health, identity, promoted.jobId)) {
      throw new Error('worker release health receipt is invalid');
    }
    return { staged, preflight, promoted, health };
  } catch (healthError) {
    try {
      const rollback = await authorizedBroker.operateWorkerRelease({ operation: 'rollback', ...common });
      if (rollback?.ok !== true || rollback.operation !== 'rollback' || rollback.rolledBackSha !== identity.sha ||
          !/^[0-9a-f]{40}$/.test(rollback.sourceSha ?? '') || rollback.sourceSha !== promoted.previousSha ||
          !hasRunReceipt(rollback, identity, promoted.jobId)) {
        throw new Error('worker release rollback receipt is invalid');
      }
      const error = new Error('worker release health failed; broker rollback completed and release lock remains held');
      error.cause = healthError;
      error.rollbackReceipt = rollback;
      throw error;
    } catch (rollbackError) {
      if (rollbackError?.rollbackReceipt) throw rollbackError;
      const error = new Error('worker release health failed and rollback is unconfirmed; persistent release lock remains held');
      error.cause = healthError;
      error.rollbackError = rollbackError;
      throw error;
    }
  }
}
