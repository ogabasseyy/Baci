import { readFileSync, statSync, unlinkSync, utimesSync } from 'node:fs';

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
      // a replacement that installed concurrently keeps its file), or
      // the heartbeat-fresh lock refuses the replacement until the
      // 30s stale window elapses.
      try {
        if (ownsWriterLock(lockPath, owned)) unlinkSync(lockPath);
      } catch {
        /* Best effort: the exit below is the guarantee. */
      }
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
