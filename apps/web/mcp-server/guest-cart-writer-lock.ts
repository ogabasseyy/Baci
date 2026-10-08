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

export function acquireWriterLock(directory: string): void {
  mkdirSync(directory, { recursive: true });
  const key = realpathSync(directory);
  if (heldWriterLocks.has(key)) return;
  const lockPath = path.join(directory, WRITER_LOCK_FILE);
  const claim = () => {
    const fd = openSync(lockPath, 'wx', 0o600);
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
