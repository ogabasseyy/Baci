import { randomUUID } from 'node:crypto';
import {
  closeSync,
  linkSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

export function createDrainFileLockReclaimer() {
  function readLockSnapshot(lockPath) {
    try {
      const before = statSync(lockPath);
      const contents = readFileSync(lockPath, 'utf8');
      const after = statSync(lockPath);
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      ) {
        return null;
      }
      return {
        contents,
        owner: Number.parseInt(contents, 10),
        stat: after,
      };
    } catch {
      return null;
    }
  }

  function lockSnapshotIsStale(snapshot) {
    const age = Date.now() - snapshot.stat.mtimeMs;
    if (Number.isSafeInteger(snapshot.owner) && snapshot.owner > 0) {
      try {
        process.kill(snapshot.owner, 0);
        return age >= STALE_LOCK_MS;
      } catch (error) {
        if (error?.code === 'ESRCH') return true;
        if (error?.code === 'EPERM') return age >= STALE_LOCK_MS;
      }
    }
    return age >= STALE_LOCK_MS;
  }

  function sameLockIdentity(left, right) {
    return (
      left?.stat?.dev === right?.stat?.dev &&
      left?.stat?.ino === right?.stat?.ino
    );
  }

  function listReclaimMarkers(lockPath) {
    let entries;
    try {
      entries = readdirSync(dirname(lockPath), { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }

    const prefix = `${basename(lockPath)}.reclaim-`;
    return entries
      .filter((entry) => entry.name.startsWith(prefix))
      .map((entry) => join(dirname(lockPath), entry.name));
  }

  function removeReclaimMarker(markerPath, expected) {
    const current = readLockSnapshot(markerPath);
    if (!sameLockIdentity(current, expected)) return false;
    try {
      unlinkSync(markerPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return true;
  }

  function reclaimInProgress(lockPath, { ignoreMarkerPath } = {}) {
    let active = false;
    for (const markerPath of listReclaimMarkers(lockPath)) {
      if (markerPath === ignoreMarkerPath) continue;
      const marker = readLockSnapshot(markerPath);
      if (!marker) {
        try {
          if (Date.now() - statSync(markerPath).mtimeMs < STALE_LOCK_MS) {
            active = true;
          } else {
            unlinkSync(markerPath);
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        continue;
      }
      if (lockSnapshotIsStale(marker)) {
        removeReclaimMarker(markerPath, marker);
        continue;
      }
      active = true;
    }
    return active;
  }

  function createReclaimMarker(lockPath) {
    const markerPath = `${lockPath}.reclaim-${process.pid}-${randomUUID()}`;
    let descriptor;
    let identity;
    try {
      descriptor = openSync(markerPath, 'wx', 0o600);
      identity = { stat: statSync(markerPath) };
      writeSync(descriptor, `${process.pid}\n`);
      closeSync(descriptor);
      descriptor = undefined;
      return { markerPath, identity };
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          // Preserve the marker creation error.
        }
      }
      if (identity) {
        try {
          const current = statSync(markerPath);
          if (
            current.dev === identity.stat.dev &&
            current.ino === identity.stat.ino
          ) {
            unlinkSync(markerPath);
          }
        } catch (cleanupError) {
          if (cleanupError?.code !== 'ENOENT') {
            // Preserve the marker creation error.
          }
        }
      }
      throw error;
    }
  }

  function restoreClaimedLock(claimPath, lockPath, expected) {
    const claimed = readLockSnapshot(claimPath);
    if (!sameLockIdentity(claimed, expected)) return false;
    try {
      const current = statSync(lockPath);
      if (
        current.dev !== expected.stat.dev ||
        current.ino !== expected.stat.ino
      ) {
        return false;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    let linked = false;
    try {
      linkSync(claimPath, lockPath);
      linked = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const current = readLockSnapshot(lockPath);
      if (!sameLockIdentity(current, expected)) return false;
    }
    if (!linked && !sameLockIdentity(readLockSnapshot(lockPath), expected)) {
      return false;
    }
    try {
      unlinkSync(claimPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return true;
  }

  function removeOwnedClaims(lockPath, identity) {
    let entries;
    try {
      entries = readdirSync(dirname(lockPath), { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    const claimPrefix = `${basename(lockPath)}.stale-`;
    for (const entry of entries) {
      if (!entry.name.startsWith(claimPrefix)) continue;
      const claimPath = join(dirname(lockPath), entry.name);
      try {
        const claim = statSync(claimPath);
        if (claim.dev === identity?.dev && claim.ino === identity?.ino) {
          unlinkSync(claimPath);
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }

  function releaseDrainFileLock(lockPath, acquiredIdentity) {
    let releaseError;
    try {
      const current = statSync(lockPath);
      if (
        current.dev === acquiredIdentity?.dev &&
        current.ino === acquiredIdentity?.ino
      ) {
        // Remove this verified generation even when a reclaimer marker is visible.
        // The reclaimer will observe the missing canonical path and finish safely.
        unlinkSync(lockPath);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        try {
          removeOwnedClaims(lockPath, acquiredIdentity);
        } catch (claimError) {
          releaseError = claimError;
        }
      } else {
        releaseError = error;
      }
    }
    return releaseError;
  }

  function reclaimStaleLock(lockPath) {
    const observed = readLockSnapshot(lockPath);
    if (!observed || !lockSnapshotIsStale(observed)) return false;

    // Publish a marker before moving the canonical lock; contenders honor it.
    if (reclaimInProgress(lockPath)) return false;
    const marker = createReclaimMarker(lockPath);
    try {
      // Unique markers avoid clobbering one another, but two reclaimers can
      // still observe an empty marker set at the same time. If another marker
      // appeared after ours, yield so no reclaimer moves the canonical lock
      // while a contender is making the same decision.
      if (
        reclaimInProgress(lockPath, { ignoreMarkerPath: marker.markerPath })
      ) {
        return false;
      }
      const current = readLockSnapshot(lockPath);
      if (!current) return true;
      if (
        !sameLockIdentity(observed, current) ||
        !lockSnapshotIsStale(current)
      ) {
        return false;
      }

      const claimPath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
      try {
        renameSync(lockPath, claimPath);
      } catch (error) {
        if (error?.code === 'ENOENT') return true;
        throw error;
      }

      const claimed = readLockSnapshot(claimPath);
      if (!claimed) return true;
      if (!sameLockIdentity(observed, claimed)) {
        // Preserve a replacement generation if the pathname changed.
        restoreClaimedLock(claimPath, lockPath, claimed);
        return false;
      }
      if (!lockSnapshotIsStale(claimed)) {
        restoreClaimedLock(claimPath, lockPath, claimed);
        return false;
      }
      try {
        unlinkSync(claimPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      return true;
    } finally {
      removeReclaimMarker(marker.markerPath, marker.identity);
    }
  }

  return { reclaimInProgress, reclaimStaleLock, releaseDrainFileLock };
}

const STALE_LOCK_MS = 60_000;
