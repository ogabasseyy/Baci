/**
 * Cross-mount recall for wallet-only VTU idempotency keys: retries
 * reuse the key and the route's row dedupes, never double-charges.
 *
 * Entries key by canonical descriptor (server-fingerprint mirror),
 * owner+merchant scoped then digested. Deletion rule (R68): only a
 * view that just showed a result may forget it; background passes
 * mark successes stale so suppressed outcomes replay.
 *
 * Durability: MMKV. Uniform 7-day TTL; 5-minute stale window within.
 */

import {
  hasLegacyVtuScopeKeys,
  isExpiredPendingVtuEntry,
  parsePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './pending-vtu-idempotency-codec';
import {
  clearForgottenVtuScopes,
  clearPendingVtuSnapshot,
  forgottenVtuScopes,
  loadPendingVtuSnapshot,
  noteForgottenVtuScopes,
  persistPendingVtuEntries,
} from './pending-vtu-idempotency-store';
import {
  hasNotedPendingVtuReferenceIn,
  isStalePendingVtuSuccessIn,
  listNotedPendingVtuReferencesFrom,
  markPendingVtuCompletedIn,
} from './pending-vtu-reference-queries';

/** Sequential mobile UX never has more than a couple of pendings in flight. */
const MAX_PENDING_PURCHASES = 32;

/**
 * Recall window: resolutions land within seconds; an older replay
 * is a NEW intent reusing a completed key — applying it would
 * present the earlier vend as the new purchase.
 */
export const PENDING_VTU_STALE_AFTER_MS = 5 * 60 * 1000;

interface PendingVtuPurchase {
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

const pendingPurchases = new Map<string, PendingVtuPurchase>();

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

function persistPendingVtuPurchases(): boolean {
  // Merge before write (Codex R143 P1): persisting the raw in-memory
  // map would drop entries a sibling tab persisted since this tab
  // loaded — after a restart the dropped key is unrecoverable and a
  // retry mints fresh and double-debits.
  syncPendingVtuPurchasesFromSnapshot();
  return persistPendingVtuEntries(pendingPurchases);
}

// Restart recovery: rehydrate before any submit runs in this launch.
// One-time migration write-back: when the snapshot still holds raw
// scope keys, persist the migrated digests now so an abandoned
// entry stops retaining plaintext identifiers for the full TTL
// (Codex R54 6rrFRH). Expo web tabs share the MMKV/localStorage
// bucket, so recall/persist/list re-sync at runtime (Codex R143 P1) —
// and snapshot tombstones ride along via forgottenVtuScopes.
const initialPendingVtuSnapshot = loadPendingVtuSnapshot();
hydratePendingVtuPurchases(initialPendingVtuSnapshot);
if (hasLegacyVtuScopeKeys(initialPendingVtuSnapshot)) {
  persistPendingVtuPurchases();
}

/**
 * Key previously used for this exact purchase, if still pending.
 * Referenced-but-uncompleted entries outlive the 7-day TTL (the
 * server leaves unconfirmed rows processing indefinitely); all
 * other TTL-aged entries drop.
 */
export function recallPendingVtuKey(
  descriptor: string,
  now: number = Date.now()
): string | null {
  // Import sibling-tab keys first (Codex R143 P1): without this,
  // an already-open tab misses a key another tab persisted, mints
  // fresh, and the server debits a second transaction.
  syncPendingVtuPurchasesFromSnapshot(now);
  const pending = pendingPurchases.get(descriptor);
  if (!pending) return null;
  if (isExpiredPendingVtuEntry(pending, now)) {
    pendingPurchases.delete(descriptor);
    persistPendingVtuPurchases();
    return null;
  }
  return pending.key;
}

/**
 * Frees one slot by dropping an EXPIRED entry (recall would drop it
 * anyway). TTL-retained entries are never victims — the registry
 * overflows instead (their retry would mint fresh and double-debit).
 */
function enforcePendingVtuCap(now: number = Date.now()): void {
  for (const [scoped, entry] of pendingPurchases) {
    if (isExpiredPendingVtuEntry(entry, now)) {
      pendingPurchases.delete(scoped);
      return;
    }
  }
}

/**
 * Records the key (cap-enforced). New generations supersede the
 * scope tombstone only once durable (R94 P2, R99 P2); false when
 * memory-only — dropped AND the tombstone restored so a retry
 * re-mints AND re-persists (R96 P1, web mirror).
 */
export function rememberPendingVtuPurchase(
  descriptor: string,
  key: string,
  scopeTag?: string
): boolean {
  if (
    !pendingPurchases.has(descriptor) &&
    pendingPurchases.size >= MAX_PENDING_PURCHASES
  ) {
    enforcePendingVtuCap();
  }
  // Restored on persist failure below (Codex R99 P2): the old
  // entry is only gone from storage when THIS snapshot lands.
  const priorTombstone = forgottenVtuScopes.get(descriptor);
  pendingPurchases.delete(descriptor);
  forgottenVtuScopes.delete(descriptor);
  pendingPurchases.set(descriptor, {
    key,
    reference: null,
    ...(scopeTag !== undefined ? { scopeTag } : {}),
    rememberedAt: Date.now(),
    completedAt: null,
  });
  if (!persistPendingVtuPurchases()) {
    pendingPurchases.delete(descriptor);
    if (priorTombstone !== undefined) {
      forgottenVtuScopes.set(descriptor, priorTombstone);
    }
    return false;
  }
  return true;
}

/** Attaches the server reference once a non-terminal response arrives. */
export function notePendingVtuReference(
  descriptor: string,
  reference: string
): void {
  const pending = pendingPurchases.get(descriptor);
  if (pending) {
    pending.reference = reference;
    persistPendingVtuPurchases();
  }
}

/** True when this reference was noted for the descriptor. */
export function hasNotedPendingVtuReference(
  descriptor: string,
  reference: string
): boolean {
  return hasNotedPendingVtuReferenceIn(pendingPurchases, descriptor, reference);
}

/** Records observed success on a RETAINED entry (first wins; immediate successes reset instead). */
export function markPendingVtuCompleted(
  descriptor: string,
  now: number = Date.now()
): void {
  markPendingVtuCompletedIn(
    pendingPurchases,
    persistPendingVtuPurchases,
    descriptor,
    now
  );
}

/** Staleness predicate (contract in isStalePendingVtuSuccessIn). Callers MUST forget and prompt fresh. */
export function isStalePendingVtuSuccess(
  descriptor: string,
  reference: string,
  now: number = Date.now()
): boolean {
  return isStalePendingVtuSuccessIn(
    pendingPurchases,
    descriptor,
    reference,
    now,
    PENDING_VTU_STALE_AFTER_MS
  );
}

/**
 * Forgets retained entries by NOTED server reference. SHOWN-context
 * only (history/backfill views displaying the result): an identical
 * repeat is a new intent that must mint fresh. Background passes
 * MUST use markSettledPendingVtuByReference instead (R68 6rwG9F).
 */
export function forgetPendingVtuByReference(
  reference: string,
  now: number = Date.now()
): void {
  const scopes: string[] = [];
  for (const [descriptor, pending] of pendingPurchases) {
    if (pending.reference !== reference) continue;
    pendingPurchases.delete(descriptor);
    // Key-bound tombstone (Codex R143 P1): bind the deleted
    // generation so a sibling tab's newer generation survives.
    noteForgottenVtuScopes([descriptor], now, pending.key);
    scopes.push(descriptor);
  }
  if (scopes.length > 0) {
    persistPendingVtuPurchases();
  }
}

/** Settles background-observed terminal successes WITHOUT deleting
 * (R68 6rwG9F): marked entries are skipped (stale guard presents),
 * unmarked are marked already-stale ("Already Completed", no recharge). */
export function markSettledPendingVtuByReference(
  reference: string,
  now: number = Date.now()
): void {
  let touched = false;
  for (const pending of pendingPurchases.values()) {
    if (pending.reference !== reference || pending.completedAt !== null) {
      continue;
    }
    pending.completedAt = now - PENDING_VTU_STALE_AFTER_MS - 1;
    touched = true;
  }
  if (touched) {
    persistPendingVtuPurchases();
  }
}

/** Drops the recall entry once its purchase reaches a terminal outcome. */
export function forgetPendingVtuPurchase(
  descriptor: string,
  now: number = Date.now()
): void {
  const live = pendingPurchases.get(descriptor);
  pendingPurchases.delete(descriptor);
  noteForgottenVtuScopes([descriptor], now, live?.key);
  persistPendingVtuPurchases();
}

/**
 * Noted references across live entries, deduped. With a scope tag,
 * other owners' tagged entries are excluded; untagged fail open.
 */
export function listNotedPendingVtuReferences(scopeTag?: string): string[] {
  syncPendingVtuPurchasesFromSnapshot();
  return listNotedPendingVtuReferencesFrom(pendingPurchases.values(), scopeTag);
}

/** Test-only escape hatch: module state survives across test cases. */
export function clearPendingVtuKeys(): void {
  pendingPurchases.clear();
  clearForgottenVtuScopes();
  clearPendingVtuSnapshot();
}
