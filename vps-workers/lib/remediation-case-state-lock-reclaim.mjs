import { linkSync, readFileSync } from 'node:fs';

const claimSnapshot = (claimPath, stat) => {
  const metadata = stat(claimPath, { throwIfNoEntry: false });
  if (!metadata) return null;
  let content;
  try {
    content = readFileSync(claimPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let owner;
  try {
    owner = JSON.parse(content);
  } catch {
    owner = null;
  }
  return {
    content,
    dev: metadata.dev,
    ino: metadata.ino,
    mtimeMs: metadata.mtimeMs,
    owner,
    size: metadata.size,
  };
};

const sameClaimSnapshot = (expected, current) =>
  current &&
  expected.content === current.content &&
  expected.dev === current.dev &&
  expected.ino === current.ino &&
  expected.mtimeMs === current.mtimeMs &&
  expected.size === current.size;

const sameLockIdentity = (expected, current) =>
  current &&
  expected?.dev === current.dev &&
  expected.ino === current.ino &&
  expected.mtimeMs === current.mtimeMs;

function acquireRecoverableClaim({
  claimPath,
  lockPath,
  ownerPath,
  nowMs,
  isAlive,
  startedAt,
  stat,
  unlink,
  completeOwner,
  removeOwnerPath,
  isStaleLock,
}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      linkSync(ownerPath, claimPath);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const snapshot = claimSnapshot(claimPath, stat);
    if (
      !snapshot ||
      !isStaleLock({
        lockPath: claimPath,
        modifiedAt: snapshot.mtimeMs,
        owner: snapshot.owner,
        nowMs,
        isAlive,
        startedAt,
        stat,
      }) ||
      !sameClaimSnapshot(snapshot, claimSnapshot(claimPath, stat))
    ) {
      return false;
    }
    if (attempt === 1) return false;
    try {
      unlink(claimPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (completeOwner(snapshot.owner)) {
      removeOwnerPath(`${lockPath}.owner-${snapshot.owner.token}`, unlink);
    }
  }
  return false;
}

export function reclaimStaleLock({
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
}) {
  const claimPath = `${lockPath}.reclaim-${
    completeOwner(owner) ? owner.token : 'ownerless'
  }`;
  if (
    !acquireRecoverableClaim({
      claimPath,
      lockPath,
      ownerPath,
      nowMs,
      isAlive,
      startedAt,
      stat,
      unlink,
      completeOwner,
      removeOwnerPath,
      isStaleLock,
    })
  ) {
    return false;
  }
  let reclaimed = false;
  let reclaimError;
  try {
    const matchesStaleLock =
      completeOwner(owner) ||
      sameLockIdentity(lockIdentity, stat(lockPath, { throwIfNoEntry: false }));
    if (matchesStaleLock && sameLockOwner(owner, readLockOwner(lockPath))) {
      try {
        unlink(lockPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (completeOwner(owner)) {
        try {
          unlink(`${lockPath}.owner-${owner.token}`);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
      reclaimed = true;
    }
  } catch (error) {
    reclaimError = error;
  }
  try {
    unlink(claimPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') reclaimError ||= error;
  }
  if (reclaimError) throw reclaimError;
  return reclaimed;
}
