import {
  linkSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
} from 'node:fs';

const WRITER_HEARTBEAT_INTERVAL_MS = 5_000;

export interface OwnedLock {
  lockPath: string;
  content: string;
  dev: number;
  ino: number;
  heartbeat: NodeJS.Timeout;
}

export function readLockContent(lockPath: string): string | null {
  try {
    return readFileSync(lockPath, 'utf8');
  } catch {
    return null;
  }
}

// Ownership binds the claim content to the file identity captured at claim
// time: a takeover installs a new inode, so even a same-content replacement
// is detected and never refreshed.
function ownsWriterLock(lockPath: string, owned: OwnedLock): boolean {
  try {
    const identity = statSync(lockPath);
    if (identity.dev !== owned.dev || identity.ino !== owned.ino) return false;
    return readLockContent(lockPath) === owned.content;
  } catch {
    return false;
  }
}

/**
 * Removes a verified own claim without unlinking the shared pathname
 * after a check: the rename atomically captures whatever generation
 * exists, identity is verified on the captured file (no concurrent
 * claimant can slip a generation between the check and the delete), and
 * only a matching generation is deleted. A captured foreign generation
 * (a replacement installed before the rename) is restored atomically
 * via link, which fails when a third claimant landed meanwhile — its
 * claim then wins and the orphaned side file stays inert for the
 * stale-lock sweeper. All failures are best-effort: the caller is
 * exiting, and the worst case is a stale-window wait.
 */
export function removeVerifiedOwnClaim(
  lockPath: string,
  owned: OwnedLock
): void {
  const sidePath = `${lockPath}.stale-released-${process.pid}`;
  try {
    renameSync(lockPath, sidePath);
  } catch {
    return;
  }
  let ownGeneration = false;
  try {
    const identity = statSync(sidePath);
    ownGeneration =
      identity.dev === owned.dev &&
      identity.ino === owned.ino &&
      readLockContent(sidePath) === owned.content;
  } catch {
    /* Treat an unreadable capture as foreign. */
  }
  if (ownGeneration) {
    try {
      unlinkSync(sidePath);
    } catch {
      /* Best effort: the sweeper reclaims stale sidecars. */
    }
    return;
  }
  try {
    linkSync(sidePath, lockPath);
  } catch {
    return;
  }
  try {
    unlinkSync(sidePath);
  } catch {
    /* lockPath already carries the restored claim. */
  }
}

/**
 * Starts the renewal timer for an installed claim. Every tick verifies
 * ownership, refreshes the mtime, and re-verifies, failing closed
 * (release + exit) on takeover or refresh failure so the process never
 * serves writes without the single-writer guarantee. Extracted from the
 * writer-lock utility to hold the 300-line file budget.
 */
export function startWriterHeartbeat(
  lockPath: string,
  owned: OwnedLock,
  release: () => void
): void {
  const failClosed = (cause: 'taken over' | 'no longer refreshable') => {
    clearInterval(owned.heartbeat);
    release();
    console.error(
      `[guest-cart] writer lock for ${lockPath} was ${cause}; exiting instead of writing without the single-writer guarantee.`
    );
    process.exit(1);
  };
  owned.heartbeat = setInterval(() => {
    // A process suspended past the stale window must not refresh a lock
    // another process took over while it slept: verify ownership first,
    // and fail closed when the lock no longer carries our claim.
    if (!ownsWriterLock(lockPath, owned)) {
      failClosed('taken over');
      return;
    }
    try {
      const now = new Date();
      utimesSync(lockPath, now, now);
    } catch {
      // Ownership verified above, yet the refresh failed (read-only
      // remount, metadata I/O fault): a stale-but-serving writer
      // violates the guarantee exactly like a displaced one, so fail
      // closed. Unlike the takeover path — where the claim file now
      // belongs to the replacement and must be left untouched — this
      // claim is still ours: remove it (re-verifying identity first so
      // belongs to the replacement and must be left untouched — this
      // claim is still ours: remove it through the generation-bound
      // capture above, or the heartbeat-fresh lock refuses the
      // replacement until the 30s stale window elapses.
      removeVerifiedOwnClaim(lockPath, owned);
      failClosed('no longer refreshable');
      return;
    }
    // A claimant may have installed a fresh claim between the ownership
    // read and the refresh, so our utimes may have landed on their file:
    // re-verify and exit immediately instead of serving writes without
    // the guarantee until the next tick.
    if (!ownsWriterLock(lockPath, owned)) failClosed('taken over');
  }, WRITER_HEARTBEAT_INTERVAL_MS);
  owned.heartbeat.unref();
}
