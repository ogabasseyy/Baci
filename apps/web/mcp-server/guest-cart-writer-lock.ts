import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import {
  GuestCartStorageUnavailableError,
  directoryNotWritableError,
  guestCartWriteError,
  isPermissionError,
  isStorageWriteError,
  refuseSecondWriter,
} from './guest-cart-writer-lock-errors';

// Cross-process single-writer guard: the in-memory queues only serialize
// operations within one process, so the cart directory itself carries an
// exclusive lock. Claims are atomic (`wx`); heartbeats renew only the exact
// file identity captured at claim time, and takeovers verify the moved
// generation after renaming it aside, restoring a fresh claim that landed
// mid-takeover instead of stealing it, so simultaneous stale claimants
// elect exactly one owner.
const WRITER_LOCK_FILE = '.writer.lock';
const WRITER_HEARTBEAT_INTERVAL_MS = 5_000;
const WRITER_LOCK_STALE_MS = 30_000;
interface OwnedLock {
  lockPath: string;
  content: string;
  dev: number;
  ino: number;
  heartbeat: NodeJS.Timeout;
}
const heldWriterLocks = new Map<string, OwnedLock>();

function readLockContent(lockPath: string): string | null {
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

export function acquireWriterLock(directory: string): void {
  try {
    // Cart filenames are the Bearer [REDACTED] tokens: match the store's 0700 so other
    // local users cannot enumerate live carts through the fallback directory.
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    if (isPermissionError(error))
      throw directoryNotWritableError(directory, error);
    throw error;
  }
  // Creation mode does not affect pre-existing directories (a restored or
  // pre-created volume keeps its mode), so restrict explicitly and verify:
  // group/other access would expose the token filenames.
  try {
    chmodSync(directory, 0o700);
  } catch {
    /* Verified below; the claim maps real permission failures. */
  }
  if (process.platform !== 'win32') {
    let mode = 0;
    try {
      mode = statSync(directory).mode & 0o777;
    } catch (error) {
      if (isPermissionError(error))
        throw directoryNotWritableError(directory, error);
      throw error;
    }
    if (mode & 0o077)
      throw new GuestCartStorageUnavailableError(
        `Guest-cart directory ${directory} is accessible by other users (mode ${mode.toString(8)}); restrict it to owner-only access (chmod 700 ${directory}).`
      );
  }
  const key = realpathSync(directory);
  if (heldWriterLocks.has(key)) return;
  const lockPath = path.join(directory, WRITER_LOCK_FILE);
  const content = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  const claim = () => {
    let fd: number;
    try {
      fd = openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if (isPermissionError(error))
        throw directoryNotWritableError(lockPath, error);
      throw error;
    }
    try {
      writeSync(fd, content);
    } catch (error) {
      // A claim that cannot be written (disk full, quota exhausted) must
      // degrade the guest-cart tool instead of crashing the server — and
      // must not leave an empty lock that later startups refuse on. The
      // typed outage routes through createGuestCartStoreOrDegraded.
      try {
        unlinkSync(lockPath);
      } catch {
        /* Best effort: the typed outage below is the signal. */
      }
      if (isStorageWriteError(error))
        throw guestCartWriteError(lockPath, error);
      throw error;
    } finally {
      closeSync(fd);
    }
  };
  try {
    claim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // Identity sandwich: read the claim around its mtime so a file
    // replaced mid-read is detected. Only the exact stale generation we
    // verified may be moved aside; anything else fails closed instead of
    // risking a fresh claim being renamed away and electing two owners.
    // (Pids are deliberately not consulted: they are meaningless across
    // container restarts sharing this volume, which is exactly when
    // crash recovery must work.)
    let before: string | null = null;
    let mtimeMs: number | null = null;
    let after: string | null = null;
    try {
      before = readLockContent(lockPath);
      mtimeMs = before === null ? null : statSync(lockPath).mtimeMs;
      after = readLockContent(lockPath);
    } catch (readError) {
      const code = (readError as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        after = null;
      } else if (isPermissionError(readError)) {
        throw directoryNotWritableError(lockPath, readError);
      } else {
        throw readError;
      }
    }
    if (after !== null) {
      if (
        before === null ||
        before !== after ||
        mtimeMs === null ||
        Date.now() - mtimeMs <= WRITER_LOCK_STALE_MS
      )
        refuseSecondWriter(lockPath, directory);
      // Move the verified stale claim aside, then confirm the generation
      // actually moved: a fresh claim that landed after our sandwich must
      // be restored, not stolen. Simultaneous stale takeovers still meet
      // at the exclusive re-claim below, so exactly one process wins; a
      // holder suspended past the stale window can briefly overlap a
      // takeover, and its heartbeat exits on wake instead of writing
      // without the guarantee.
      const staleSidePath = `${lockPath}.stale-${process.pid}`;
      let renamed = false;
      try {
        renameSync(lockPath, staleSidePath);
        renamed = true;
      } catch {
        // Lost the race (taken over or freshly claimed); the claim
        // below decides.
      }
      if (renamed) {
        // A heartbeat refreshes only the timestamp, leaving content
        // untouched: compare both, so a holder that resumed after our
        // sandwich is detected and keeps its lock.
        let movedMtime: number | null = null;
        try {
          movedMtime = statSync(staleSidePath).mtimeMs;
        } catch {
          movedMtime = null;
        }
        if (
          movedMtime !== mtimeMs ||
          readLockContent(staleSidePath) !== before
        ) {
          // Stole a live claim: put it back when nothing claimed
          // meanwhile, then refuse. A claimant displaced here heals via
          // its heartbeat instead of writing without the guarantee.
          if (readLockContent(lockPath) === null) {
            try {
              renameSync(staleSidePath, lockPath);
            } catch {
              try {
                unlinkSync(staleSidePath);
              } catch {
                /* A leftover side file is inert. */
              }
            }
          } else {
            try {
              unlinkSync(staleSidePath);
            } catch {
              /* A leftover side file is inert. */
            }
          }
          refuseSecondWriter(lockPath, directory);
        }
        try {
          unlinkSync(staleSidePath);
        } catch {
          /* A leftover side file is inert; the claim below decides. */
        }
      }
    }
    // When the lock vanished mid-flight the owner released gracefully,
    // so claim directly; the exclusive create still arbitrates racers
    // and maps permission failures.
    try {
      claim();
    } catch (claimError) {
      if ((claimError as NodeJS.ErrnoException).code === 'EEXIST')
        refuseSecondWriter(lockPath, directory);
      throw claimError;
    }
  }
  // Our claim is installed and fresh, so no other writer can have replaced
  // it yet: capture its identity for generation-bound renewal below.
  const { dev, ino } = statSync(lockPath);
  const owned: OwnedLock = {
    lockPath,
    content,
    dev,
    ino,
    heartbeat: undefined as unknown as NodeJS.Timeout,
  };
  heldWriterLocks.set(key, owned);
  const failClosed = () => {
    clearInterval(owned.heartbeat);
    heldWriterLocks.delete(key);
    console.error(
      `[guest-cart] writer lock for ${lockPath} was taken over; exiting instead of writing without the single-writer guarantee.`
    );
    process.exit(1);
  };
  owned.heartbeat = setInterval(() => {
    // A process suspended past the stale window must not refresh a lock
    // another process took over while it slept: verify ownership first,
    // and fail closed when the lock no longer carries our claim.
    if (!ownsWriterLock(lockPath, owned)) {
      failClosed();
      return;
    }
    try {
      const now = new Date();
      utimesSync(lockPath, now, now);
    } catch {
      /* Lock lost; takeover is another writer's decision now. */
    }
    // A claimant may have installed a fresh claim between the ownership
    // read and the refresh, so our utimes may have landed on their file:
    // re-verify and exit immediately instead of serving writes without
    // the guarantee until the next tick.
    if (!ownsWriterLock(lockPath, owned)) failClosed();
  }, WRITER_HEARTBEAT_INTERVAL_MS);
  owned.heartbeat.unref();
}

/**
 * Releases every lock this process owns. Ownership is verified by content:
 * a lock taken over by another process is left untouched. Called during
 * graceful shutdown so a replacement container starts without waiting out
 * the stale-takeover window.
 */
export function releaseWriterLocks(): void {
  for (const [key, owned] of heldWriterLocks) {
    clearInterval(owned.heartbeat);
    heldWriterLocks.delete(key);
    try {
      if (readLockContent(owned.lockPath) === owned.content)
        unlinkSync(owned.lockPath);
    } catch {
      /* Best effort during shutdown. */
    }
  }
}
