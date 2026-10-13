import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { createLegacyRemediationLockCleaner } from './remediation-case-state-legacy-lock-cleanup.mjs';
import { reclaimStaleLock } from './remediation-case-state-lock-reclaim.mjs';
import { hasRemediationGlobalLockCapability } from './remediation-global-lock.mjs';

const STALE_LOCK_MS = 2 * 60 * 1_000;
const LOCK_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const processIsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
};
const processStartedAt = (pid) => {
  try {
    return (
      execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 1_000,
      }).trim() || null
    );
  } catch {
    return null;
  }
};

const completeOwner = (owner) =>
  owner &&
  Number.isSafeInteger(owner.pid) &&
  owner.pid > 0 &&
  typeof owner.createdAt === 'string' &&
  Number.isFinite(Date.parse(owner.createdAt)) &&
  typeof owner.token === 'string' &&
  LOCK_TOKEN_PATTERN.test(owner.token);

const readLockOwner = (lockPath) => {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
};

const sameLockOwner = (expected, current) =>
  completeOwner(expected)
    ? current?.token === expected.token
    : !completeOwner(current);

const removeOwnerPath = (ownerPath, unlink) => {
  try {
    unlink(ownerPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const isStaleLock = ({
  lockPath,
  stat,
  modifiedAt = stat(lockPath, { throwIfNoEntry: false })?.mtimeMs,
  owner,
  nowMs,
  isAlive,
  startedAt,
}) => {
  if (
    completeOwner(owner) &&
    nowMs - Date.parse(owner.createdAt) > STALE_LOCK_MS
  ) {
    if (!isAlive(owner.pid)) return true;
    if (typeof owner.processStartedAt !== 'string') return false;
    const currentProcessStartedAt = startedAt(owner.pid);
    return (
      typeof currentProcessStartedAt === 'string' &&
      currentProcessStartedAt !== owner.processStartedAt
    );
  }
  return (
    !completeOwner(owner) &&
    Number.isFinite(modifiedAt) &&
    nowMs - modifiedAt > STALE_LOCK_MS
  );
};

export function createRemediationCaseStateStorage({
  createEmptyState,
  isValidState,
  path,
  processIsAlive: isAlive = processIsAlive,
  processStartedAt: startedAt = processStartedAt,
  stat = statSync,
  unlink = unlinkSync,
  lockCapabilityValidator = hasRemediationGlobalLockCapability,
  remediationLock,
}) {
  if (
    remediationLock !== undefined &&
    !lockCapabilityValidator(remediationLock)
  ) {
    throw new Error('global remediation lock capability is required');
  }
  const externallyLocked = remediationLock !== undefined;
  const lockPath = `${path}.lock`;
  const cleanLegacyLock = externallyLocked
    ? createLegacyRemediationLockCleaner(lockPath, unlink)
    : null;
  const localProcessStartedAt = startedAt(process.pid);

  function read() {
    let content;
    try {
      content = readFileSync(path, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return createEmptyState();
      throw new Error(`Unable to read remediation case state at ${path}`, {
        cause: error,
      });
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Invalid remediation case state at ${path}`, {
        cause: error,
      });
    }
    if (!isValidState(parsed)) {
      throw new Error(`Invalid remediation case state at ${path}`);
    }
    return parsed;
  }

  function persist(state) {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    try {
      renameSync(temporaryPath, path);
    } catch (error) {
      try {
        unlink(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') throw cleanupError;
      }
      throw error;
    }
  }

  function withLock(nowMs, fallback, action) {
    mkdirSync(dirname(path), { recursive: true });
    if (externallyLocked) {
      cleanLegacyLock();
      return action(read());
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = randomUUID();
      const ownerPath = `${lockPath}.owner-${token}`;
      writeFileSync(
        ownerPath,
        JSON.stringify({
          createdAt: new Date(nowMs).toISOString(),
          pid: process.pid,
          processStartedAt: localProcessStartedAt,
          token,
        }),
        { flag: 'wx', mode: 0o600 }
      );
      try {
        linkSync(ownerPath, lockPath);
      } catch (error) {
        if (error?.code !== 'EEXIST') {
          removeOwnerPath(ownerPath, unlink);
          throw error;
        }
        let reclaimed = false;
        try {
          const owner = readLockOwner(lockPath);
          if (attempt === 0) {
            const lockIdentity = stat(lockPath, { throwIfNoEntry: false });
            reclaimed =
              isStaleLock({
                lockPath,
                modifiedAt: lockIdentity?.mtimeMs,
                owner,
                nowMs,
                isAlive,
                startedAt,
                stat,
              }) &&
              reclaimStaleLock({
                lockPath,
                lockIdentity,
                owner,
                ownerPath,
                nowMs,
                isAlive,
                startedAt,
                stat,
                unlink,
                completeOwner,
                readLockOwner,
                sameLockOwner,
                removeOwnerPath,
                isStaleLock,
              });
          }
        } catch {
          reclaimed = false;
        } finally {
          removeOwnerPath(ownerPath, unlink);
        }
        if (reclaimed) {
          continue;
        }
        return fallback;
      }
      let result;
      let actionError;
      try {
        result = action(read());
      } catch (error) {
        actionError = error;
      }
      let releaseError;
      let owner;
      let ownerContent;
      try {
        ownerContent = readFileSync(lockPath, 'utf8');
      } catch (error) {
        if (error?.code !== 'ENOENT') releaseError = error;
      }
      if (ownerContent !== undefined) {
        try {
          owner = JSON.parse(ownerContent);
        } catch {
          owner = null;
        }
      }
      if (owner?.token === token) {
        try {
          unlink(lockPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') releaseError ||= error;
        }
      }
      try {
        removeOwnerPath(ownerPath, unlink);
      } catch (error) {
        if (!releaseError) releaseError = error;
      }
      if (actionError) throw actionError;
      if (releaseError) throw releaseError;
      return result;
    }
    return fallback;
  }

  return { persist, read, withLock };
}
