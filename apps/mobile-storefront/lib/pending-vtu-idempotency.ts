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
 * Key previously used for this exact purchase, if still pending.
 * Referenced-but-uncompleted entries outlive the 7-day TTL (the
 * server leaves unconfirmed rows processing indefinitely); all
 * other TTL-aged entries drop.
 */
export function recallPendingVtuKey(
  descriptor: string,
  now: number = Date.now()
): string | null {
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

/** Records the key a purchase was submitted with (cap-enforced). */
export function rememberPendingVtuPurchase(
  descriptor: string,
  key: string,
  scopeTag?: string
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
    ...(scopeTag !== undefined ? { scopeTag } : {}),
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
 * True when a success replays an already-completed purchase: same
 * NOTED reference AND completion observed past the recall window, so
 * this submit is a NEW intent. Callers MUST forget and prompt fresh.
 * Staleness keys off COMPLETION time (slow first completions still
 * present); unobserved completions are NEVER stale.
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
    scopes.push(descriptor);
  }
  if (scopes.length > 0) {
    noteForgottenVtuScopes(scopes, now);
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
  pendingPurchases.delete(descriptor);
  noteForgottenVtuScopes([descriptor], now);
  persistPendingVtuPurchases();
}

/**
 * Noted references across live entries, deduped. With a scope tag,
 * other owners' tagged entries are excluded; untagged fail open.
 */
export function listNotedPendingVtuReferences(scopeTag?: string): string[] {
  const references = new Set<string>();
  for (const entry of pendingPurchases.values()) {
    if (
      entry.reference !== null &&
      (scopeTag === undefined ||
        entry.scopeTag === undefined ||
        entry.scopeTag === scopeTag)
    ) {
      references.add(entry.reference);
    }
  }
  return [...references];
}

/** Test-only escape hatch: module state survives across test cases. */
export function clearPendingVtuKeys(): void {
  pendingPurchases.clear();
  clearForgottenVtuScopes();
  clearPendingVtuSnapshot();
}
