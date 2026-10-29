/** Production entrypoint for the authenticated, root-owned worker release broker. */
import { readProductionReleaseLock, PRODUCTION_RELEASE_LOCK_PATH } from './production-release-lock.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  operateWorkerRelease,
  preflightWorkerRelease,
  stageWorkerRelease,
} from '../../vps-workers/lib/worker-release-broker-client.mjs';

const SHA_RE = /^[0-9a-f]{40}$/;

function identityFromEnvironment(env) {
  const identity = {
    runId: env.GITHUB_RUN_ID,
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    sha: env.BACI_EXPECTED_APP_SHA ?? env.GITHUB_SHA,
  };
  if (!/^[1-9][0-9]*$/.test(identity.runId ?? '') || !Number.isSafeInteger(identity.runAttempt) ||
      identity.runAttempt < 1 || !SHA_RE.test(identity.sha ?? '')) {
    throw new Error('worker release coordinator identity is invalid');
  }
  return identity;
}

function assertLockOwner(lock, identity) {
  if (!lock || lock.state !== 'worker_syncing' || lock.run_id !== identity.runId ||
      lock.run_attempt !== identity.runAttempt || lock.sha !== identity.sha) {
    throw new Error('persistent production release lock does not match this worker run');
  }
}

function hasRunReceipt(receipt, identity, expectedJobId) {
  return String(receipt?.runId) === identity.runId && receipt?.runAttempt === identity.runAttempt &&
    /^[1-9][0-9]{0,19}$/.test(String(receipt?.jobId)) &&
    (expectedJobId === undefined || String(receipt.jobId) === String(expectedJobId));
}

/** Execute broker promotion while retaining the durable production lock on every uncertain outcome. */
export async function runWorkerReleaseCoordinator({
  env = process.env,
  lockPath = PRODUCTION_RELEASE_LOCK_PATH,
  readLock = readProductionReleaseLock,
  broker,
} = {}) {
  const identity = identityFromEnvironment(env);
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
  const recoveryStatus = await authorizedBroker.operateWorkerRelease({ operation: 'recovery-status', ...common });
  if (recoveryStatus?.ok !== true || recoveryStatus.operation !== 'recovery-status' ||
      recoveryStatus.sourceSha !== identity.sha || typeof recoveryStatus.pending !== 'boolean') {
    throw new Error('worker release recovery status receipt is invalid');
  }
  let recovery;
  if (recoveryStatus.pending) {
    const target = recoveryStatus.recoveryOf;
    const owner = recoveryStatus.recoveryOwner;
    if (!target || !owner || !SHA_RE.test(target.sha ?? '') || !SHA_RE.test(recoveryStatus.previousSha ?? '') ||
        !/^[1-9][0-9]{0,19}$/.test(String(target.run_id)) || !Number.isSafeInteger(target.run_attempt) ||
        !/^[1-9][0-9]{0,19}$/.test(String(target.job_id)) || typeof recoveryStatus.currentOwner !== 'boolean') {
      throw new Error('worker release recovery target receipt is invalid');
    }
    recovery = await authorizedBroker.operateWorkerRelease({
      operation: 'recover', ...common, ...(!recoveryStatus.currentOwner ? { recoveryOf: target } : {}),
    });
    if (recovery?.ok !== true || recovery.operation !== 'recover' || recovery.sourceSha !== identity.sha ||
        recovery.recovered !== true || recovery.rolledBackSha !== target.sha ||
        recovery.previousSha !== recoveryStatus.previousSha || !hasRunReceipt(recovery, identity)) {
      throw new Error('worker release recovery receipt is invalid; persistent release lock remains held');
    }
  }
  const staged = await authorizedBroker.stageWorkerRelease(common);
  if (staged?.ok !== true || staged.operation !== 'stage' || staged.sourceSha !== identity.sha ||
      !Number.isSafeInteger(staged.entryCount) || staged.entryCount < 1) {
    throw new Error('worker release stage receipt is invalid');
  }

  const preflight = await authorizedBroker.preflightWorkerRelease(common);
  if (preflight?.ok !== true || preflight.operation !== 'preflight' || preflight.sourceSha !== identity.sha ||
      !Number.isSafeInteger(preflight.entryCount) || preflight.entryCount < 1) {
    throw new Error('worker release preflight receipt is invalid');
  }

  // Never infer whether an ambiguous promote succeeded. Preserve the lock for operator reconciliation.
  const promoted = await authorizedBroker.operateWorkerRelease({ operation: 'promote', ...common });
  if (promoted?.ok !== true || promoted.operation !== 'promote' || promoted.sourceSha !== identity.sha ||
      !hasRunReceipt(promoted, identity) ||
      !SHA_RE.test(promoted.previousSha ?? '')) {
    throw new Error('worker release promote receipt is invalid; persistent release lock remains held');
  }

  try {
    const health = await authorizedBroker.operateWorkerRelease({ operation: 'health', ...common });
    // The broker health check reads the active release pointer and fixed system services.
    // Requiring its exact SHA is the installed-release proof for the broker-managed root.
    if (health?.ok !== true || health.operation !== 'health' || health.sourceSha !== identity.sha ||
        health.healthy !== true || !hasRunReceipt(health, identity, promoted.jobId)) {
      throw new Error('worker release installed SHA or health receipt is invalid');
    }
    return { recovery, staged, preflight, promoted, health };
  } catch (healthError) {
    try {
      const rollback = await authorizedBroker.operateWorkerRelease({ operation: 'rollback', ...common });
      if (rollback?.ok !== true || rollback.operation !== 'rollback' || rollback.rolledBackSha !== identity.sha ||
          !SHA_RE.test(rollback.sourceSha ?? '') || rollback.sourceSha !== promoted.previousSha ||
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkerReleaseCoordinator().then(({ health }) => {
    process.stdout.write(`Worker release installed and healthy at ${health.sourceSha}.\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
