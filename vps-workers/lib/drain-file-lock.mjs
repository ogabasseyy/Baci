import { closeSync, mkdirSync, openSync, statSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDrainFileLockReclaimer } from './drain-file-lock-reclamation.mjs';

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 30_000;
const { reclaimInProgress, reclaimStaleLock, releaseDrainFileLock } =
  createDrainFileLockReclaimer();

function waitForLock() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
}

/** Serialize the short active-drain rotation and append critical section. */
export function withDrainFileLock(lockPath, action) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let descriptor;
  let acquiredIdentity;
  let createdIdentity;

  while (descriptor === undefined) {
    if (reclaimInProgress(lockPath)) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for drain lock: ${lockPath}`);
      }
      waitForLock();
      continue;
    }
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      createdIdentity = statSync(lockPath);
      writeSync(descriptor, `${process.pid}\n`);
      closeSync(descriptor);
      acquiredIdentity = statSync(lockPath);
      createdIdentity = undefined;
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          // The write failure remains the useful error for this attempt.
        }
      }
      descriptor = undefined;
      if (createdIdentity) {
        const releaseError = releaseDrainFileLock(lockPath, createdIdentity);
        createdIdentity = undefined;
        if (releaseError) throw releaseError;
      }
      if (error?.code !== 'EEXIST') throw error;

      if (reclaimStaleLock(lockPath)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for drain lock: ${lockPath}`);
      }
      waitForLock();
    }

    if (descriptor !== undefined && reclaimInProgress(lockPath)) {
      const releaseError = releaseDrainFileLock(lockPath, acquiredIdentity);
      descriptor = undefined;
      acquiredIdentity = undefined;
      if (releaseError) throw releaseError;
    }
  }

  let result;
  let actionError;
  try {
    result = action();
  } catch (error) {
    actionError = error;
  }

  const releaseError = releaseDrainFileLock(lockPath, acquiredIdentity);

  if (actionError) throw actionError;
  if (releaseError) throw releaseError;
  return result;
}
