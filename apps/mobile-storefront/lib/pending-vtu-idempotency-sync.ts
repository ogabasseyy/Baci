import {
  hasLegacyVtuScopeKeys,
  parsePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './pending-vtu-idempotency-codec';
import {
  acquirePendingVtuMintLock,
  forgottenVtuScopes,
  loadPendingVtuSnapshot,
  noteForgottenVtuScopes,
  PENDING_VTU_MINT_LOCK_NAME,
  persistPendingVtuEntries,
  releasePendingVtuMintLock,
} from './pending-vtu-idempotency-store';

export interface PendingVtuPurchase {
  key: string;
  /** Server reference once a response arrives; null while unsent/unanswered. */
  reference: string | null;
  /** Owner+merchant scope tag (absent on pre-tag entries); settle filter. */
  scopeTag?: string;
  /** Client-local timestamp of the original submit (elapsed math only). */
  rememberedAt: number;
  /** Terminal-success-observed time (null while processing). Stale keys off THIS. */
  completedAt: number | null;
}

/**
 * Live pending-purchase map, owned here (web parity: the sync module
 * owns the map, persistence, and merging; ops live in
 * pending-vtu-idempotency.ts). Split out per the 300-line module-size
 * gate (Codex R145 P1).
 */
export const pendingPurchases = new Map<string, PendingVtuPurchase>();

/** Serializes live entries + tombstones for MMKV (prunes TTL-expired). */
export function serializePendingVtuPurchases(now: number = Date.now()): string {
  return serializePendingVtuEntries(
    pendingPurchases,
    [...forgottenVtuScopes].map(([s, record]) => ({
      scoped: s,
      forgottenAt: record.forgottenAt,
      ...(record.key !== undefined ? { key: record.key } : {}),
    })),
    now
  );
}

/**
 * Restores entries from a snapshot (same code path as restart).
 * In-memory entries win so hydration never clobbers a live attempt;
 * snapshot tombstones are adopted to keep suppressing deletions.
 */
export function hydratePendingVtuPurchases(
  serialized: string | null,
  now: number = Date.now()
): void {
  const snapshot = parsePendingVtuSnapshot(serialized, now);
  for (const t of snapshot.forgotten) {
    noteForgottenVtuScopes([t.scoped], t.forgottenAt, t.key);
  }
  for (const [scoped, entry] of snapshot.entries) {
    if (!pendingPurchases.has(scoped)) {
      // Legacy snapshots predate completion tracking: normalize the
      // absent field so restore never crashes on old rows.
      pendingPurchases.set(scoped, {
        ...entry,
        completedAt: entry.completedAt ?? null,
      });
    }
  }
}

/**
 * Merges entries another Expo web tab persisted since this tab loaded
 * (Codex R143 P1 — web mirror of syncPendingVtuPurchasesFromSnapshot).
 * Without this, a retry in a second already-open tab misses the first
 * tab's key, mints fresh, and the server debits a second transaction.
 * In-memory entries win (this tab's writes are fresher than the
 * snapshot); same-key entries merge newer knowledge (reference /
 * completion); snapshot tombstones live-delete matches and suppress
 * older generations. Key-bound on both sides (web R55/R61 parity):
 * only the deleted generation's key is suppressed; keyless legacy
 * tombstones fall back to timestamp arbitration.
 */
export function syncPendingVtuPurchasesFromSnapshot(
  now: number = Date.now()
): void {
  const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot(), now);
  for (const t of snapshot.forgotten) {
    const live = pendingPurchases.get(t.scoped);
    // Live-delete is KEY-bound (web R55 parity): a newer generation
    // under the same scope survives an older generation's tombstone
    // even when the tombstone's clock is later. Key equality ignores
    // timestamps (same key means the live entry IS the deleted
    // generation); keyless tombstones (pre-binding) fall back to
    // timestamp arbitration.
    if (
      live &&
      (t.key === undefined
        ? live.rememberedAt <= t.forgottenAt
        : live.key === t.key)
    ) {
      pendingPurchases.delete(t.scoped);
    }
    noteForgottenVtuScopes([t.scoped], t.forgottenAt, t.key);
  }
  for (const [scoped, entry] of snapshot.entries) {
    const live = pendingPurchases.get(scoped);
    if (live) {
      if (live.key === entry.key) {
        if (live.reference === null && entry.reference != null) {
          live.reference = entry.reference;
        }
        if (entry.completedAt != null) {
          live.completedAt =
            live.completedAt === null
              ? entry.completedAt
              : Math.min(live.completedAt, entry.completedAt);
        }
      }
      continue;
    }
    // Entry-merge is KEY-bound like live-delete (web R61 parity).
    const tombstone = forgottenVtuScopes.get(scoped);
    if (
      tombstone !== undefined &&
      entry.rememberedAt <= tombstone.forgottenAt &&
      (tombstone.key === undefined || tombstone.key === entry.key)
    ) {
      continue;
    }
    pendingPurchases.set(scoped, {
      ...entry,
      completedAt: entry.completedAt ?? null,
    });
  }
}

/**
 * Synchronous merge + save. LOCK DISCIPLINE (Codex R152 P1, web
 * mirror): merge-read and snapshot write must run under the
 * cross-tab mutex — an unlocked whole-snapshot replacement can
 * clobber a key a sibling tab durably saved. Call only from inside
 * runPendingVtuMintLocked (mint triple, flush below) or
 * single-threaded unit tests — other writers schedule a flush.
 */
export function persistPendingVtuPurchases(): boolean {
  // Merge before write (Codex R143 P1): persisting the raw in-memory
  // map would drop entries a sibling tab persisted since this tab
  // loaded — after a restart the dropped key is unrecoverable and a
  // retry mints fresh and double-debits.
  syncPendingVtuPurchasesFromSnapshot();
  return persistPendingVtuEntries(pendingPurchases);
}

/**
 * Locked persist (Codex R152 P1, web mirror): merge + save under
 * the cross-tab mutex. False = fallback lock unacquired (caller
 * fails closed); the locks-unavailable rejection propagates.
 */
export async function flushPendingVtuPurchases(): Promise<boolean> {
  const saved = await runPendingVtuMintLocked(() =>
    persistPendingVtuPurchases()
  );
  return saved ?? false;
}

let pendingVtuFlushQueued = false;
let pendingVtuFlushChain: Promise<unknown> = Promise.resolve();

/**
 * Coalesced background persist (web mirror): memory updates sync, one
 * chained flush drains under the mutex. Contention drops retry here
 * (Codex R153 P2) — with no further writes nothing else lands them.
 * Terminal failures log and drop; mint persists inline and throws.
 */
export function schedulePendingVtuFlush(): void {
  if (pendingVtuFlushQueued) {
    return;
  }
  pendingVtuFlushQueued = true;
  pendingVtuFlushChain = pendingVtuFlushChain.then(async () => {
    pendingVtuFlushQueued = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        if (await flushPendingVtuPurchases()) return;
      } catch (error) {
        console.error('VTU registry background flush failed:', error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    console.error('VTU registry background flush dropped after retries.');
  });
}

/**
 * Terminal-success forget (Codex R153 P2, web mirror): memory drops sync,
 * then one locked flush is awaited. False = scheduled retry.
 */
export async function forgetPendingVtuPurchaseDurable(
  descriptor: string
): Promise<boolean> {
  const live = pendingPurchases.get(descriptor);
  pendingPurchases.delete(descriptor);
  noteForgottenVtuScopes([descriptor], Date.now(), live?.key);
  try {
    if (await flushPendingVtuPurchases()) return true;
  } catch {
    /* Locks unavailable: fall through to the scheduled retry. */
  }
  schedulePendingVtuFlush();
  return false;
}

// Restart recovery: rehydrate before any submit runs in this launch.
// One-time migration write-back: when the snapshot still holds raw
// scope keys, persist the migrated digests now so an abandoned
// entry stops retaining plaintext identifiers for the full TTL
// (Codex R54 6rrFRH). Expo web tabs share the MMKV/localStorage
// bucket, so recall/persist/list re-sync at runtime (Codex R143 P1) —
// and snapshot tombstones ride along via forgottenVtuScopes.
/**
 * Cross-tab mint mutex runner (R148, real mutex R149, web mirror):
 * the recall → mint → remember triple runs under navigator.locks
 * on Expo web — a genuine cross-tab mutex, so exactly one tab
 * mints per descriptor race and the loser re-recalls inside the
 * lock, adopting the winner's key. Without locks, multi-tab
 * browsers fail closed (Codex R152 P1, web mirror) — the
 * storage-token fallback in the store module serves only
 * single-threaded runtimes (native, SSR), where the
 * confirm-retry protocol is atomic. Sync
 * fn, single global name. Null = fallback unacquired; the caller
 * fails closed. Callback throws propagate — never fall back
 * around them, or a mint could run twice. Never throws
 * synchronously: one async contract from both branches.
 */
interface VtuNavigatorLocks {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
}

function getNavigatorLocks(): VtuNavigatorLocks | undefined {
  if (typeof navigator === 'undefined') {
    return undefined;
  }
  return (navigator as Navigator & { locks?: VtuNavigatorLocks }).locks;
}

export const PENDING_VTU_LOCKS_UNAVAILABLE_ERROR =
  'Could not secure this purchase for retry. Please update your browser and try again.';

/**
 * True only in a real multi-tab browser (window AND document). SSR,
 * React Native, and Node lack document — single-threaded runtimes
 * where the storage fallback is atomic. (Web mirror: jsdom counts
 * as a browser, which is what the browser-branch tests need.)
 */
function isMultiTabBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export async function runPendingVtuMintLocked<T>(
  fn: () => T
): Promise<T | null> {
  const locks = getNavigatorLocks();
  if (locks) {
    // Deferred, not returned directly: some LockManager
    // implementations invoke a throwing callback synchronously,
    // which would escape as a sync throw (and can wedge the
    // manager's queue, hanging later holders). The hop keeps the
    // never-throws-synchronously contract on both branches.
    return Promise.resolve().then(() =>
      locks.request(PENDING_VTU_MINT_LOCK_NAME, () => fn())
    );
  }
  if (isMultiTabBrowser()) {
    // Fail closed (Codex R152 P1, web mirror): a multi-tab browser
    // without Web Locks cannot exclude a sibling tab — the storage
    // fallback has no compare-and-swap, so minting here could
    // double-debit. Thrown from an async runner: a rejection, never
    // sync.
    throw new Error(PENDING_VTU_LOCKS_UNAVAILABLE_ERROR);
  }
  const token = await acquirePendingVtuMintLock();
  if (!token) {
    return Promise.resolve(null);
  }
  // Deferred like the locks path; the token is already held, so
  // the microtask hop cannot interleave a rival.
  return Promise.resolve()
    .then(fn)
    .finally(() => releasePendingVtuMintLock(token));
}

const initialPendingVtuSnapshot = loadPendingVtuSnapshot();
hydratePendingVtuPurchases(initialPendingVtuSnapshot);
if (hasLegacyVtuScopeKeys(initialPendingVtuSnapshot)) {
  schedulePendingVtuFlush();
}
