import {
  hasLegacyVtuScopeKeys,
  parsePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './pending-vtu-idempotency-codec';
import {
  clearPendingVtuMintLock,
  forgottenVtuScopes,
  loadPendingVtuMintLock,
  loadPendingVtuSnapshot,
  noteForgottenVtuScopes,
  persistPendingVtuEntries,
  savePendingVtuMintLock,
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

export function persistPendingVtuPurchases(): boolean {
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
/**
 * Cross-tab mint mutex (Codex R148 P1, web mirror): sync recall
 * fixes STALE snapshots, but two Expo web tabs recalling
 * simultaneously both miss and mint distinct keys — the server
 * debits twice. The mint triple runs under this token lock; the
 * loser blocks, then re-recalls inside the lock and adopts the
 * winner's key. Fail-closed: unacquired/unavailable storage
 * returns null and the caller throws (no key, no POST). No SSR
 * fast path: a null bucket already fails remember() closed, and
 * the lock follows the same semantics.
 */
export const PENDING_VTU_MINT_LOCK_TTL_MS = 1000;
export const PENDING_VTU_MINT_LOCK_WAIT_MS = 250;

function spinWaitMs(ms: number): number {
  const end = Date.now() + ms;
  let now = Date.now();
  while (now < end) {
    now = Date.now();
  }
  return now;
}

export function acquirePendingVtuMintLock(
  now: number = Date.now()
): string | null {
  const token = `mint-${now}-${Math.floor(Math.random() * 2 ** 32).toString(36)}`;
  const deadline = now + PENDING_VTU_MINT_LOCK_WAIT_MS;
  let at = now;
  while (at < deadline) {
    const held = loadPendingVtuMintLock();
    if (!held || at - held.at >= PENDING_VTU_MINT_LOCK_TTL_MS) {
      savePendingVtuMintLock(token, at);
      if (loadPendingVtuMintLock()?.token === token) {
        return token;
      }
    }
    at = spinWaitMs(1);
  }
  return null;
}

export function releasePendingVtuMintLock(token: string): void {
  // Release only our own token: a TTL-expired successor's claim
  // must survive our finally.
  if (loadPendingVtuMintLock()?.token === token) {
    clearPendingVtuMintLock();
  }
}

const initialPendingVtuSnapshot = loadPendingVtuSnapshot();
hydratePendingVtuPurchases(initialPendingVtuSnapshot);
if (hasLegacyVtuScopeKeys(initialPendingVtuSnapshot)) {
  persistPendingVtuPurchases();
}
