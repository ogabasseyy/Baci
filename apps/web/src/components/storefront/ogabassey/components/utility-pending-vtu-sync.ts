/**
 * Cross-tab persistence sync for the wallet-only VTU pending registry.
 *
 * Split from utility-pending-idempotency.ts per the 300-line budget:
 * this module owns the live entry map, the deletion tombstones, and
 * the localStorage merge/persist cycle; the registry module owns the
 * recall/remember/note/complete/stale operations on top.
 */
import {
  clearPendingVtuMintLock,
  loadPendingVtuMintLock,
  loadPendingVtuSnapshot,
  savePendingVtuMintLock,
  savePendingVtuSnapshot,
} from './utility-pending-idempotency-store';
import {
  hasLegacyVtuScopeKeys,
  parsePendingVtuSnapshot,
  serializePendingVtuEntries,
} from './utility-pending-vtu-codec';

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

/**
 * Scopes deliberately deleted since the last persist (scope ->
 * deletion record). Sync imports snapshot tombstones here too, so
 * a completed key deleted in another tab is dropped locally
 * instead of written back on the next persist. Cleared on every
 * persist (the snapshot then carries the tombstones).
 *
 * The record binds the deleted KEY generation, not just the scope:
 * a newer in-flight key under the same scope must survive a
 * tombstone written for an older generation (Codex R55 6rrMIj) —
 * timestamp-only arbitration would erase it and its retry would
 * mint fresh and double-debit. Keyless records (pre-binding
 * snapshots) fall back to timestamp arbitration.
 */
export interface ForgottenVtuScope {
  forgottenAt: number;
  key?: string;
}

export const forgottenScopedKeys = new Map<string, ForgottenVtuScope>();

/**
 * Records a deliberate deletion (single choke point so the key
 * binding cannot be forgotten at one of the forget sites). Latest
 * deletion wins per scope — remember() deletes the record, so a
 * record always postdates the entry it names.
 */
export function noteForgottenVtuScope(
  scoped: string,
  forgottenAt: number,
  key?: string
): void {
  forgottenScopedKeys.set(scoped, { forgottenAt, key });
}

/** Serializes live entries for localStorage (prunes TTL-expired). */
export function serializePendingVtuPurchases(
  now: number = Date.now()
): string {
  return serializePendingVtuEntries(
    pendingVtuPurchases,
    [...forgottenScopedKeys].map(([scoped, record]) => ({
      scoped,
      forgottenAt: record.forgottenAt,
      ...(typeof record.key === 'string' ? { key: record.key } : {}),
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
    const known = forgottenScopedKeys.get(scoped);
    if (known === undefined || forgottenAt > known.forgottenAt) {
      forgottenScopedKeys.set(scoped, { forgottenAt, key });
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
    // Entry-merge is KEY-bound like live-delete (Codex R61 6rtSNf):
    // a newer generation (different key) must survive an older
    // generation's tombstone even when remembered earlier (stale
    // tab B forgetting K1 after tab A minted K2 — timestamp-only
    // suppression would erase the active K2 key and a retry would
    // mint K3 and debit again). A re-remembered entry (newer than
    // the tombstone) still merges, and keyless tombstones
    // (pre-binding) keep timestamp arbitration.
    const tombstone = forgottenScopedKeys.get(scoped);
    if (
      tombstone !== undefined &&
      entry.rememberedAt <= tombstone.forgottenAt &&
      (tombstone.key === undefined || tombstone.key === entry.key)
    ) {
      continue;
    }
    pendingVtuPurchases.set(scoped, {
      ...entry,
      completedAt: entry.completedAt ?? null,
    });
  }
}

export function persistPendingVtuPurchases(): boolean {
  syncPendingVtuPurchasesFromSnapshot();
  // Gate the tombstone clear on a durable write: if setItem throws
  // (quota/private mode), the snapshot still holds the completed
  // entries — clearing would resurrect them on the next sync.
  // Retained tombstones ride along on the next persist instead.
  // Returns the save outcome (Codex R96 P1): remember() refuses to
  // hand out a minted key the retry cannot recover after reload.
  if (savePendingVtuSnapshot(serializePendingVtuPurchases())) {
    forgottenScopedKeys.clear();
    return true;
  }
  return false;
}

// Reload recovery: rehydrate before any submit runs in this browser.
// One-time migration write-back: when the snapshot still holds raw
// scope keys, persist the migrated digests now (through the syncing
// persist — never a raw save — so snapshot tombstones survive and a
// newer cross-tab write merges instead of being clobbered).
// Without this an abandoned entry keeps its plaintext identifiers
// for the full TTL despite migrate-on-read (Codex R54 6rrFRH).
/**
 * Cross-tab mint mutex (Codex R148 P1): sync-before-recall fixes
 * STALE snapshots, but two tabs recalling simultaneously both miss
 * and mint distinct keys — the server debits twice. The mint triple
 * (recall → mint → remember) runs under this token lock so exactly
 * one tab mints per descriptor race; the loser re-recalls and adopts
 * the winner's key. Single global key (holds last ~1ms, so
 * cross-descriptor contention is a non-issue).
 *
 * Protocol: write own token, re-read to confirm (last-writer-wins +
 * confirmation elects exactly one holder per round); bounded 1ms
 * spin; TTL-gated steal for crashed holders (same-device clock).
 * Fail-closed: unacquired or unavailable storage returns null and
 * the caller throws the storage-unavailable error (no key, no POST,
 * no double debit). Off-DOM (SSR) holds vacuously: no tabs exist.
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
  if (typeof localStorage === 'undefined') {
    return `ssr-${now}`;
  }
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
