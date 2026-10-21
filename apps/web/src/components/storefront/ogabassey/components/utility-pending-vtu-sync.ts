/**
 * Cross-tab persistence sync for the wallet-only VTU pending registry.
 *
 * Split from utility-pending-idempotency.ts per the 300-line budget:
 * this module owns the live entry map and the localStorage
 * merge/persist cycle (tombstones live in
 * utility-pending-vtu-tombstones.ts); the registry module owns the
 * recall/remember/note/complete/stale operations on top.
 */
import {
  loadPendingVtuSnapshot,
  runPendingVtuMintLocked,
  savePendingVtuSnapshot,
} from './utility-pending-idempotency-store';
import {
  hasLegacyVtuScopeKeys,
  parsePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './utility-pending-vtu-codec';
import {
  clearForgottenVtuScopes,
  forgottenScopedKeys,
  listForgottenVtuScopes,
  noteForgottenVtuScope,
} from './utility-pending-vtu-tombstones';

export interface PendingVtuPurchase {
  key: string;
  /** Server reference once a response arrives; null while unsent/unanswered. */
  reference: string | null;
  /** Owner+merchant scope tag (absent on pre-tag entries); settle filter. */
  scopeTag?: string;
  /** Client-local timestamp of the original submit (elapsed math only). */
  rememberedAt: number;
  /**
   * Client-local timestamp when terminal success was first OBSERVED on
   * this entry (null while processing/unanswered). The stale-success
   * predicate keys off THIS — never off the submit/noted time — so a
   * slow first completion (e.g. via reconciliation minutes later) is
   * presented instead of misreported as "Already Completed".
   */
  completedAt: number | null;
}

export const pendingVtuPurchases = new Map<string, PendingVtuPurchase>();

/** Serializes live entries for localStorage (prunes TTL-expired). */
export function serializePendingVtuPurchases(
  now: number = Date.now()
): string {
  return serializePendingVtuEntries(
    pendingVtuPurchases,
    listForgottenVtuScopes(),
    now
  );
}

/**
 * Restores entries from a snapshot (same code path as reload).
 * In-memory entries win over persisted ones so hydration never
 * clobbers a live attempt.
 */
export function hydratePendingVtuPurchases(
  serialized: string | null,
  now: number = Date.now()
): void {
  for (const [scoped, entry] of parsePendingVtuSnapshot(serialized, now)
    .entries) {
    if (!pendingVtuPurchases.has(scoped)) {
      // Legacy snapshots predate completion tracking: normalize the
      // absent field so restore never crashes on old rows.
      pendingVtuPurchases.set(scoped, {
        ...entry,
        completedAt: entry.completedAt ?? null,
      });
    }
  }
}

/**
 * Merges entries another tab persisted since this tab loaded (live
 * entries win: this tab's own writes are fresher than the snapshot).
 * Without this, a retry in a second already-open tab would miss the
 * first tab's key, mint fresh, and double-debit. Simultaneous
 * cross-tab mints remain a known residual (sync recall cannot take an
 * async lock) — same class as double-device submits.
 */
export function syncPendingVtuPurchasesFromSnapshot(): void {
  const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
  for (const { scoped, forgottenAt, key } of snapshot.forgotten) {
    const live = pendingVtuPurchases.get(scoped);
    // Live-delete is KEY-bound (Codex R55 6rrMIj): a newer
    // generation under the same scope survives an older
    // generation's tombstone even when the tombstone's clock is
    // later (stale tab, skewed clocks). Key equality ignores
    // timestamps (causality beats clocks: same key means the live
    // entry IS the deleted generation); keyless tombstones
    // (pre-binding) fall back to timestamp arbitration.
    if (
      live &&
      (key === undefined
        ? live.rememberedAt <= forgottenAt
        : live.key === key)
    ) {
      pendingVtuPurchases.delete(scoped);
    }
    noteForgottenVtuScope(scoped, forgottenAt, key);
  }
  for (const [scoped, entry] of snapshot.entries) {
    const live = pendingVtuPurchases.get(scoped);
    if (live) {
      // Same attempt, newer knowledge: another tab observed the
      // reference or completion after this tab imported the key.
      // Without this merge the local copy stays uncompleted forever
      // and the stale guard presents the old vend as a new purchase
      // instead of requiring a fresh submit. Different keys mean a
      // different generation — the live one wins.
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
    // Entry-merge is KEY-bound like live-delete (Codex R61 6rtSNf):
    // a newer generation (different key) must survive an older
    // generation's tombstone even when remembered earlier (stale
    // tab B forgetting K1 after tab A minted K2 — timestamp-only
    // suppression would erase the active K2 key and a retry would
    // mint K3 and debit again). A re-remembered entry (newer than
    // the tombstone) still merges, and keyless tombstones
    // (pre-binding) keep timestamp arbitration.
    // Multi-key (CodeRabbit Major, mobile mirror): a scope can
    // carry several generation tombstones — any match suppresses.
    const tombstones = forgottenScopedKeys.get(scoped) ?? [];
    const suppressed = tombstones.some(
      (tombstone) =>
        entry.rememberedAt <= tombstone.forgottenAt &&
        (tombstone.key === undefined || tombstone.key === entry.key)
    );
    if (suppressed) {
      continue;
    }
    pendingVtuPurchases.set(scoped, {
      ...entry,
      completedAt: entry.completedAt ?? null,
    });
  }
}

/**
 * Synchronous merge + save. LOCK DISCIPLINE (Codex R152 P1): the
 * merge-read and the snapshot write must run under the cross-tab
 * mutex — an unlocked whole-snapshot replacement can clobber a key
 * a sibling tab durably saved between our merge and our write, and
 * the retry then mints a second debit. Call only from inside
 * runPendingVtuMintLocked (the mint triple, flush below) or
 * single-threaded unit tests — all other writers schedule a flush.
 */
export function persistPendingVtuPurchases(): boolean {
  syncPendingVtuPurchasesFromSnapshot();
  // Gate the tombstone clear on a durable write: if setItem throws
  // (quota/private mode), the snapshot still holds the completed
  // entries — clearing would resurrect them on the next sync.
  // Retained tombstones ride along on the next persist instead.
  // Returns the save outcome: the mint triple refuses to hand out
  // a minted key the retry cannot recover after reload (R96 P1).
  if (savePendingVtuSnapshot(serializePendingVtuPurchases())) {
    clearForgottenVtuScopes();
    return true;
  }
  return false;
}

/**
 * Locked persist (Codex R152 P1): merge + save under the cross-tab
 * mutex, so a concurrent tab's durable key can never be clobbered
 * by a stale-map write. False = fallback lock unacquired (caller
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
 * Coalesced background persist for registry mutations: memory updates
 * synchronously, one chained flush drains under the mutex. Contention
 * drops retry here (Codex R153 P2) — with no further writes nothing
 * else would land them. Terminal failures log and drop; the mint path
 * persists inline and throws. Exported flush lets tests drain.
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
        if (await flushPendingVtuPurchases()) {
          return;
        }
      } catch (error) {
        console.error('VTU registry background flush failed:', error);
        return;
      }
      // Contended: yield a macrotask so the holder drains, then retry.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    console.error('VTU registry background flush dropped after retries.');
  });
}

/**
 * Terminal-success forget (Codex R153 P2): memory drops synchronously,
 * then a locked flush is awaited (3 tight attempts, R155: transient
 * write blips absorb inline) so the deletion is durable BEFORE the
 * result finalizes. True = durable; false = persistent failure
 * (logged; background retry scheduled; memory stays correct).
 */
export async function forgetPendingVtuPurchaseDurable(
  payloadSignature: string
): Promise<boolean> {
  const live = pendingVtuPurchases.get(payloadSignature);
  pendingVtuPurchases.delete(payloadSignature);
  noteForgottenVtuScope(payloadSignature, Date.now(), live?.key);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (await flushPendingVtuPurchases()) return true;
    } catch {
      break; // Locks unavailable: only the scheduled retry can help.
    }
  }
  console.error('VTU registry terminal forget not durable; retry scheduled.');
  schedulePendingVtuFlush();
  return false;
}

/**
 * Generation veto for settlement mutations (Codex P1): when a
 * sibling tab persisted a newer same-descriptor generation, adopt
 * it into memory and report superseded so the caller skips its
 * stale note — noting on the stale entry would flush it back over
 * the newer generation (memory-wins), orphaning the newer key.
 * Forgets need no veto (clearing memory self-heals via merge).
 */
export function isCurrentVtuGeneration(
  payloadSignature: string,
  expectedKey: string
): boolean {
  const live = pendingVtuPurchases.get(payloadSignature);
  if (!live || live.key !== expectedKey) {
    return false;
  }
  const persisted = parsePendingVtuSnapshot(
    loadPendingVtuSnapshot()
  ).entries.find(([entryScoped]) => entryScoped === payloadSignature);
  if (
    persisted &&
    persisted[1].key !== expectedKey &&
    persisted[1].rememberedAt >= live.rememberedAt
  ) {
    pendingVtuPurchases.set(payloadSignature, {
      ...persisted[1],
      completedAt: persisted[1].completedAt ?? null,
    });
    return false;
  }
  return true;
}

// Reload recovery: rehydrate before any submit runs in this browser.
// One-time migration write-back: when the snapshot still holds raw
// scope keys, persist the migrated digests now (through the syncing
// persist — never a raw save — so snapshot tombstones survive and a
// newer cross-tab write merges instead of being clobbered).
// Without this an abandoned entry keeps its plaintext identifiers
// for the full TTL despite migrate-on-read (Codex R54 6rrFRH).

const initialPendingVtuSnapshot = loadPendingVtuSnapshot();
hydratePendingVtuPurchases(initialPendingVtuSnapshot);
if (hasLegacyVtuScopeKeys(initialPendingVtuSnapshot)) {
  schedulePendingVtuFlush();
}
