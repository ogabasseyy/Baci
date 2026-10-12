/**
 * Cross-tab persistence sync for the wallet-only VTU pending registry.
 *
 * Split from utility-pending-idempotency.ts per the 300-line budget:
 * this module owns the live entry map, the deletion tombstones, and
 * the localStorage merge/persist cycle; the registry module owns the
 * recall/remember/note/complete/stale operations on top.
 */
import {
  loadPendingVtuSnapshot,
  parsePendingVtuSnapshot,
  savePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './utility-pending-idempotency-store';

export interface PendingVtuPurchase {
  key: string;
  /** Server reference once a response arrives; null while unsent/unanswered. */
  reference: string | null;
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

/**
 * Scopes deliberately deleted since the last persist (scope ->
 * deletion time). Sync imports snapshot tombstones here too, so a
 * completed key deleted in another tab is dropped locally instead
 * of written back on the next persist. Cleared on every persist
 * (the snapshot then carries the tombstones).
 */
export const forgottenScopedKeys = new Map<string, number>();

/** Serializes live entries for localStorage (prunes TTL-expired). */
export function serializePendingVtuPurchases(
  now: number = Date.now()
): string {
  return serializePendingVtuEntries(
    pendingVtuPurchases,
    [...forgottenScopedKeys].map(([scoped, forgottenAt]) => ({
      scoped,
      forgottenAt,
    })),
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
  for (const { scoped, forgottenAt } of snapshot.forgotten) {
    const live = pendingVtuPurchases.get(scoped);
    if (live && live.rememberedAt <= forgottenAt) {
      pendingVtuPurchases.delete(scoped);
    }
    const known = forgottenScopedKeys.get(scoped);
    if (known === undefined || forgottenAt > known) {
      forgottenScopedKeys.set(scoped, forgottenAt);
    }
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
    const tombstonedAt = forgottenScopedKeys.get(scoped);
    // A re-remembered entry (newer than the tombstone) still merges:
    // only the deleted generation is suppressed.
    if (tombstonedAt !== undefined && entry.rememberedAt <= tombstonedAt) {
      continue;
    }
    pendingVtuPurchases.set(scoped, {
      ...entry,
      completedAt: entry.completedAt ?? null,
    });
  }
}

export function persistPendingVtuPurchases(): void {
  syncPendingVtuPurchasesFromSnapshot();
  // Gate the tombstone clear on a durable write: if setItem throws
  // (quota/private mode), the snapshot still holds the completed
  // entries — clearing would resurrect them on the next sync.
  // Retained tombstones ride along on the next persist instead.
  if (savePendingVtuSnapshot(serializePendingVtuPurchases())) {
    forgottenScopedKeys.clear();
  }
}

// Reload recovery: rehydrate before any submit runs in this browser.
hydratePendingVtuPurchases(loadPendingVtuSnapshot());
