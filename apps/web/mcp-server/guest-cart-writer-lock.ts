import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

// Cross-process single-writer guard: the in-memory queues only serialize
// operations within one process, so the cart directory itself carries an
// exclusive lock. Claims are atomic (`wx`); heartbeats distinguish a live
// holder from a crashed one. Suspended (not crashed) holders can briefly
// overlap a takeover, which is no worse than today's unguarded behavior.
const WRITER_LOCK_FILE = '.writer.lock';
const WRITER_HEARTBEAT_INTERVAL_MS = 5_000;
const WRITER_LOCK_STALE_MS = 30_000;
const heldWriterLocks = new Set<string>();

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
}

// A named volume mounted over the image directory does not inherit the
// image-layer chown when the volume predates it (or was created root-owned),
// so refuse with remediation instead of a raw errno: every guest-cart call
// would otherwise fail at runtime with a generic error.
function directoryNotWritableError(target: string, cause: unknown): Error {
  const uid =
    typeof process.getuid === 'function' ? process.getuid() : 'unknown';
  const detail =
    cause instanceof Error ? cause.message : 'unknown filesystem error';
  return new Error(
    `Guest-cart directory is not writable: ${target} (server uid ${uid}, ${detail}). ` +
      `Make the cart volume writable by the server user, e.g. chown the mounted directory to uid ${uid}.`
  );
}

export function acquireWriterLock(directory: string): void {
  try {
    mkdirSync(directory, { recursive: true });
  } catch (error) {
    if (isPermissionError(error))
      throw directoryNotWritableError(directory, error);
    throw error;
  }
  const key = realpathSync(directory);
  if (heldWriterLocks.has(key)) return;
  const lockPath = path.join(directory, WRITER_LOCK_FILE);
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
      writeSync(
        fd,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
      );
    } finally {
      closeSync(fd);
    }
  };
  try {
    claim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let stale = true;
    try {
      stale = Date.now() - statSync(lockPath).mtimeMs > WRITER_LOCK_STALE_MS;
    } catch {
      stale = true;
    }
    if (!stale) {
      // Fail closed with an actionable record: the refusal crashes the
      // process at startup, so log the lock path and both PIDs for the ops
      // alert trail (e.g. an accidental `--scale 2` under plain compose).
      let holder = 'unknown';
      try {
        holder = readFileSync(lockPath, 'utf8');
      } catch {
        /* Fall through with an unknown holder. */
      }
      console.error(
        `[guest-cart] refusing second writer for ${lockPath} (held by ${holder}, claimant pid ${process.pid})`
      );
      throw new Error(
        `Another MCP writer owns ${directory}; refusing to start a second guest-cart writer.`
      );
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* Lost the takeover race; the claim below decides. */
    }
    claim();
  }
  heldWriterLocks.add(key);
  const heartbeat = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(lockPath, now, now);
    } catch {
      /* Lock lost; takeover is another writer's decision now. */
    }
  }, WRITER_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
}
