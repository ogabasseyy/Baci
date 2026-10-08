import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { storedCartSchema } from '../src/schemas/guest-cart-stored-cart';

const queues = new Map<string, Promise<unknown>>();

/** Runs an operation exclusively per key, chaining onto any in-flight work. */
export async function runExclusive<T>(
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  queues.set(key, pending);
  try {
    return await pending;
  } finally {
    if (queues.get(key) === pending) queues.delete(key);
  }
}

export interface CartFileIdentity {
  mtimeMs: number;
  ino: number;
}

// Identity comparison for the eviction callback below: a preceding update
// installs a new inode, so an equal-mtime file is still recognized as
// fresh. Timestamp comparison alone misfires on coarse-resolution
// filesystems where the replacement keeps the snapshot mtime.
export function didCartFileChange(
  snapshot: CartFileIdentity,
  current: CartFileIdentity
): boolean {
  return current.ino !== snapshot.ino || current.mtimeMs !== snapshot.mtimeMs;
}

const MAX_CART_FILES = 2000;
// Crash temporaries (`<cart>.json.<uuid>.tmp`) share no pattern with cart
// files and no queue key with live writers, so only sweep ones old enough
// that no in-flight write can still own them.
const STALE_FILE_MAX_AGE_MS = 60 * 60 * 1000;
const CRASH_TEMP_PATTERN = /^[a-f0-9]{64}\.json\..+\.tmp$/;
// A crash between the stale-lock rename and its unlink orphans the sidecar
// (guest-cart-writer-lock.ts); it never matches the cart patterns below.
const STALE_LOCK_PATTERN = /^\.writer\.lock\.stale-.+$/;
const CART_FILE_PATTERN = /^[a-f0-9]{64}\.json$/;
// The expiry sweep reads and parses every cart file, so run it at most once
// per interval; expiry is still enforced per cart on every read, and
// crash-temp cleanup below always runs. The mark is set synchronously
// before the first await so concurrent callers single-flight on one scan.
const SWEEP_INTERVAL_MS = 60 * 1000;
// Keyed per directory so instances over different directories (tests,
// future multi-dir use) never suppress each other's first sweep.
const lastExpirySweepMsByDirectory = new Map<string, number>();

/**
 * Test-only read of the per-directory sweep mark. The single-flight test
 * uses it to assert the mark is set synchronously (before the first
 * await) so concurrent admissions share one scan.
 */
export function getLastExpirySweepMsForTests(directory: string): number {
  return lastExpirySweepMsByDirectory.get(directory) ?? 0;
}

/**
 * Prepares the cart directory for a write: always runs the throttled
 * janitor sweep (crash temps unconditionally, expired carts when due), and
 * when admitting a brand-new cart additionally reclaims expired files and
 * evicts the least-recently-written cart at capacity. Nesting is strictly
 * directory queue into per-file queues, never the reverse, so callers must
 * invoke this only from the directory queue (creation) or a per-file queue
 * with capacity disabled (update).
 */
export async function admitGuestCartWrite(
  directory: string,
  admitCapacity: boolean
): Promise<void> {
  const sweepStart = Date.now();
  const sweepDue =
    sweepStart - (lastExpirySweepMsByDirectory.get(directory) ?? 0) >=
    SWEEP_INTERVAL_MS;
  if (sweepDue) lastExpirySweepMsByDirectory.set(directory, sweepStart);
  const entries = await readdir(directory);
  for (const entry of entries) {
    if (CRASH_TEMP_PATTERN.test(entry) || STALE_LOCK_PATTERN.test(entry)) {
      // A crash between writeFile and rename orphans the temp file and the
      // cart-file janitor below never matches it; the same holds for a
      // stale-lock sidecar orphaned between rename and unlink. Sweep only
      // stale files so a concurrent writer's in-flight temp (or a live
      // takeover's fresh sidecar) survives.
      try {
        const orphan = path.join(directory, entry);
        const info = await stat(orphan);
        if (Date.now() - info.mtimeMs > STALE_FILE_MAX_AGE_MS)
          await unlink(orphan);
      } catch {
        /* Best effort: janitor work never fails the write. */
      }
      continue;
    }
    if (!sweepDue) continue;
    if (!CART_FILE_PATTERN.test(entry)) continue;
    const candidate = path.join(directory, entry);
    if (queues.has(candidate)) continue;
    try {
      const existing = storedCartSchema.parse(
        JSON.parse(await readFile(candidate, 'utf8'))
      );
      if (existing.expires_at <= Date.now()) await unlink(candidate);
    } catch {
      // Reads parse cart files too, so a corrupt file is already unusable
      // dead weight that would pin capacity forever. Reclaim it once old
      // enough that no external writer can still be producing it; fresh
      // files are left for a later sweep.
      try {
        const info = await stat(candidate);
        if (Date.now() - info.mtimeMs > STALE_FILE_MAX_AGE_MS)
          await unlink(candidate);
      } catch {
        /* Best effort: janitor work never fails the write. */
      }
    }
  }
  if (!admitCapacity) return;
  let cartFiles = (await readdir(directory)).filter((entry) =>
    CART_FILE_PATTERN.test(entry)
  );
  if (cartFiles.length >= MAX_CART_FILES) {
    // The throttled sweep above may have been skipped, and expired carts
    // must never force eviction of live ones: reclaim them now and recount
    // before falling back to LRU eviction.
    for (const entry of cartFiles) {
      const candidate = path.join(directory, entry);
      // Join the candidate's queue (like the eviction loop below) instead
      // of check-then-act: a concurrent update between the check and the
      // unlink could otherwise lose a live cart.
      const beforeMs = Date.now();
      // Identity, not just the clock: on a coarse-resolution filesystem a
      // racing update can keep a mtime at or below the snapshot, so the new
      // inode is what proves the file was rewritten with fresh expiry.
      let beforeIno: number | null = null;
      try {
        beforeIno = (await stat(candidate)).ino;
      } catch {
        /* Vanished; the queued callback below observes the same. */
      }
      await runExclusive(candidate, async () => {
        let existing: z.infer<typeof storedCartSchema>;
        try {
          existing = storedCartSchema.parse(
            JSON.parse(await readFile(candidate, 'utf8'))
          );
        } catch {
          // Corrupt files stay for the guarded janitor.
          return;
        }
        if (existing.expires_at > Date.now()) return;
        try {
          const info = await stat(candidate);
          if (info.mtimeMs > beforeMs) return;
          if (beforeIno !== null && info.ino !== beforeIno) return;
        } catch {
          return;
        }
        await unlink(candidate).catch(() => undefined);
      });
    }
    cartFiles = (await readdir(directory)).filter((entry) =>
      CART_FILE_PATTERN.test(entry)
    );
  }
  if (cartFiles.length >= MAX_CART_FILES) {
    // One guest must not permanently exhaust the shared pool: evict the
    // least-recently-written cart instead of failing. Idle carts may be
    // dropped under sustained pressure; active carts survive because every
    // write refreshes mtime.
    const withIdentity = (
      await Promise.all(
        cartFiles.map(async (entry) => {
          try {
            const info = await stat(path.join(directory, entry));
            return { entry, mtimeMs: info.mtimeMs, ino: info.ino };
          } catch {
            return null;
          }
        })
      )
    ).filter(
      (found): found is { entry: string; mtimeMs: number; ino: number } =>
        found !== null
    );
    withIdentity.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let evicted = false;
    for (const { entry, mtimeMs, ino } of withIdentity) {
      const candidate = path.join(directory, entry);
      // Join the cart's own queue so eviction runs strictly before or after
      // any in-flight update instead of racing it, then re-check identity:
      // a preceding update installs a new inode, so an equal-mtime file is
      // still recognized as fresh and skipped in favor of the next oldest.
      const done = await runExclusive(candidate, async () => {
        try {
          const info = await stat(candidate);
          if (didCartFileChange({ mtimeMs, ino }, info)) return false;
          await unlink(candidate);
          return true;
        } catch {
          return false;
        }
      });
      if (done) {
        evicted = true;
        // Capacity churn is otherwise silent: log the eviction (never the
        // token filename) so flood-driven displacement is visible to ops.
        console.log(
          JSON.stringify({ type: 'guest-cart', event: 'evicted_at_capacity' })
        );
        break;
      }
    }
    if (!evicted) throw new Error('Guest cart capacity reached');
  }
}
