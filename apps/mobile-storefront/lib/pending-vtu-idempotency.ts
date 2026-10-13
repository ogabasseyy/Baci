/**
 * Cross-mount recall for wallet-only VTU idempotency keys.
 *
 * The key used to live in a form ref, so remounting after "Back to Home"
 * minted a fresh UUID and the server debited a SECOND transaction. This
 * module-level registry survives remounts, so a retry reuses its key
 * and the route's `vtu_idempotency_keys` row dedupes instead.
 *
 * Entries are keyed by a canonical purchase descriptor mirroring the
 * server fingerprint, additionally owner+merchant scoped then SHA-256
 * digested (the descriptor itself omits identity, like the server
 * hash): same descriptor in means same payload out, the server's 409
 * guard stays the backstop, and no recipient identifier rests in the
 * map or the snapshot. Terminal outcomes MUST forget, or a later
 * repeat would reattach to a dead key.
 *
 * Durability: entries persist in MMKV (device-scoped) so an app
 * restart between a timed-out submit and its retry still replays the
 * same key instead of minting a fresh one and debiting twice. All
 * entries expire after a uniform 7-day horizon (persisted and live
 * recall alike, regardless of reference state): 7 days dwarf any
 * plausible processing duration, while infinite retention would
 * accumulate unboundedly. Within the TTL the 5-minute stale window
 * arbitrates success replays of noted references against
 * `rememberedAt`.
 */

import {
  hasLegacyVtuScopeKeys,
  PERSISTED_VTU_KEY_TTL_MS,
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

/** Sequential mobile UX never has more than a couple of pendings in flight. */
const MAX_PENDING_PURCHASES = 32;

/**
 * Recall window for a remembered key. Genuine resolutions land within
 * seconds of the submit; a success replay older than this is a NEW
 * purchase intent reusing a completed transaction's key, and applying
 * it would present the earlier vend as the new purchase.
 */
export const PENDING_VTU_STALE_AFTER_MS = 5 * 60 * 1000;

interface PendingVtuPurchase {
  key: string;
  /** Server reference once a response arrives; null while unsent/unanswered. */
  reference: string | null;
  /** Client-local timestamp of the original submit (elapsed math only). */
  rememberedAt: number;
  /**
   * When terminal success was first OBSERVED (null while
   * processing/unanswered). The stale predicate keys off THIS, never
   * the submit/noted time, so a slow first completion is presented
   * instead of misreported as "Already Completed".
   */
  completedAt: number | null;
}

const pendingPurchases = new Map<string, PendingVtuPurchase>();

/** Serializes live entries + tombstones for MMKV (prunes TTL-expired). */
export function serializePendingVtuPurchases(now: number = Date.now()): string {
  return serializePendingVtuEntries(
    pendingPurchases,
    [...forgottenVtuScopes].map(([s, f]) => ({ scoped: s, forgottenAt: f })),
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
    noteForgottenVtuScopes([t.scoped], t.forgottenAt);
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

function persistPendingVtuPurchases(): void {
  persistPendingVtuEntries(pendingPurchases);
}

// Restart recovery: rehydrate before any submit runs in this launch.
// One-time migration write-back: when the snapshot still holds raw
// scope keys, persist the migrated digests now so an abandoned
// entry stops retaining plaintext identifiers for the full TTL
// (Codex R54 6rrFRH). Single runtime — no cross-tab merge needed —
// and snapshot tombstones ride along via forgottenVtuScopes.
const initialPendingVtuSnapshot = loadPendingVtuSnapshot();
hydratePendingVtuPurchases(initialPendingVtuSnapshot);
if (hasLegacyVtuScopeKeys(initialPendingVtuSnapshot)) {
  persistPendingVtuPurchases();
}

/**
 * Key previously used for this exact purchase, if it is still pending.
 * Past-TTL entries are dropped instead of recalled (no client signal
 * proves terminality, so retention is horizon-based: 7 days dwarf any
 * plausible processing duration). The 5min stale check still
 * arbitrates success replays within the TTL.
 */
export function recallPendingVtuKey(
  descriptor: string,
  now: number = Date.now()
): string | null {
  const pending = pendingPurchases.get(descriptor);
  if (!pending) return null;
  if (now - pending.rememberedAt > PERSISTED_VTU_KEY_TTL_MS) {
    pendingPurchases.delete(descriptor);
    persistPendingVtuPurchases();
    return null;
  }
  return pending.key;
}

/**
 * Frees one registry slot by dropping a past-TTL entry (live recall
 * would drop it on access anyway, regardless of reference state).
 * When every entry is still live the registry OVERFLOWS past the cap
 * instead of evicting: no client-side signal proves terminality, so
 * deleting a live attempt would lose deduplication and its retry
 * would mint fresh and double-debit. Entries are tiny and the 7-day
 * TTL bounds retention, so overflow is cheap and self-healing.
 */
function enforcePendingVtuCap(now: number = Date.now()): void {
  for (const [scoped, entry] of pendingPurchases) {
    if (now - entry.rememberedAt > PERSISTED_VTU_KEY_TTL_MS) {
      pendingPurchases.delete(scoped);
      return;
    }
  }
}

/** Records the key a purchase was submitted with (cap-enforced). */
export function rememberPendingVtuPurchase(
  descriptor: string,
  key: string
): void {
  if (
    !pendingPurchases.has(descriptor) &&
    pendingPurchases.size >= MAX_PENDING_PURCHASES
  ) {
    enforcePendingVtuCap();
  }
  pendingPurchases.delete(descriptor);
  pendingPurchases.set(descriptor, {
    key,
    reference: null,
    rememberedAt: Date.now(),
    completedAt: null,
  });
  persistPendingVtuPurchases();
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
  return pendingPurchases.get(descriptor)?.reference === reference;
}

/** Records observed success on a RETAINED entry (first wins; immediate successes reset instead). */
export function markPendingVtuCompleted(
  descriptor: string,
  now: number = Date.now()
): void {
  const pending = pendingPurchases.get(descriptor);
  if (pending && pending.completedAt === null) {
    pending.completedAt = now;
    persistPendingVtuPurchases();
  }
}

/**
 * True when a success response replays an already-completed purchase
 * instead of resolving the current submit: same NOTED reference AND
 * completion was observed longer ago than the recall window, so this
 * submit is a NEW intent, not a retry. Callers MUST forget the
 * descriptor and prompt a fresh submit instead of presenting the
 * earlier vend as the new purchase. Staleness keys off the COMPLETION
 * time, never the submit/noted time, so a slow first completion is
 * presented instead of misreported as "Already Completed" (which
 * would reset the key and double-debit the prompted retry).
 * Entries with no OBSERVED completion are NEVER
 * stale. Past the TTL recall already dropped them, so this predicate
 * never sees them.
 */
export function isStalePendingVtuSuccess(
  descriptor: string,
  reference: string,
  now: number = Date.now()
): boolean {
  const pending = pendingPurchases.get(descriptor);
  if (
    !pending ||
    pending.reference === null ||
    pending.reference !== reference ||
    pending.completedAt === null
  ) {
    return false;
  }
  return now - pending.completedAt > PENDING_VTU_STALE_AFTER_MS;
}

/**
 * Forgets retained entries by NOTED server reference. The backfill
 * learns terminality from history — not from a response — so it knows
 * the reference but not the descriptor. Terminality always forgets:
 * the success is SHOWN, so an identical repeat is a new intent that
 * must mint fresh — keeping the key would present the previous vend
 * as the new purchase without delivering anything. (Marking is
 * reserved for UNSHOWN completions on the switched path.)
 */
export function forgetPendingVtuByReference(
  reference: string,
  now: number = Date.now()
): void {
  const scopes: string[] = [];
  for (const [descriptor, pending] of pendingPurchases) {
    if (pending.reference !== reference) continue;
    pendingPurchases.delete(descriptor);
    scopes.push(descriptor);
  }
  if (scopes.length > 0) {
    noteForgottenVtuScopes(scopes, now);
    persistPendingVtuPurchases();
  }
}

/** Drops the recall entry once its purchase reaches a terminal outcome. */
export function forgetPendingVtuPurchase(
  descriptor: string,
  now: number = Date.now()
): void {
  pendingPurchases.delete(descriptor);
  noteForgottenVtuScopes([descriptor], now);
  persistPendingVtuPurchases();
}

/** Test-only escape hatch: module state survives across test cases. */
export function clearPendingVtuKeys(): void {
  pendingPurchases.clear();
  clearForgottenVtuScopes();
  clearPendingVtuSnapshot();
}
