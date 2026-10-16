import { createWalletIdempotencyKey } from './utility-checkout';
import { clearPendingVtuSnapshot } from './utility-pending-idempotency-store';
import { isExpiredPendingVtuEntry } from './utility-pending-vtu-codec';
import {
  hasNotedPendingVtuReferenceIn,
  isStalePendingVtuSuccessIn,
  listNotedPendingVtuReferencesFrom,
  markPendingVtuCompletedIn,
} from './utility-pending-vtu-reference-queries';
import {
  forgottenScopedKeys,
  noteForgottenVtuScope,
  pendingVtuPurchases,
  persistPendingVtuPurchases,
  syncPendingVtuPurchasesFromSnapshot,
} from './utility-pending-vtu-sync';

/**
 * Cross-mount recall for wallet-only VTU idempotency keys (web):
 * retries reuse the key and the route's idempotency row dedupes
 * instead of double-charging. Entries key by canonical purchase
 * signature (scoped owner+merchant, SHA-256; no recipient in the
 * map/snapshot). Deletion rule (R68): only a view that just showed
 * a result may forget it; background passes mark stale instead.
 * Durability: localStorage, 7-day TTL; 5-minute stale window for
 * success replays. Sync/scoping in sibling modules; ops live here.
 */

/** Sequential web UX never has more than a couple of pendings in flight. */
const MAX_PENDING_PURCHASES = 32;

/**
 * Recall window for a remembered key. Genuine resolutions land within
 * seconds of the submit; a success replay older than this is a NEW
 * purchase intent reusing a completed transaction's key, and applying
 * it would present the earlier vend as the new purchase.
 */
export const PENDING_VTU_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Key previously used for this exact purchase, if it is still pending.
 * Referenced-but-uncompleted entries are retained past the 7-day TTL
 * (the server leaves unconfirmed rows processing indefinitely); all
 * other TTL-aged entries drop. The 5min stale check still arbitrates
 * success replays.
 */
export function recallPendingVtuKey(
  payloadSignature: string,
  now: number = Date.now()
): string | undefined {
  syncPendingVtuPurchasesFromSnapshot();
  const pending = pendingVtuPurchases.get(payloadSignature);
  if (!pending) return undefined;
  if (isExpiredPendingVtuEntry(pending, now)) {
    pendingVtuPurchases.delete(payloadSignature);
    noteForgottenVtuScope(payloadSignature, now, pending.key);
    persistPendingVtuPurchases();
    return undefined;
  }
  return pending.key;
}

/**
 * Frees one slot by dropping an EXPIRED entry (recall would drop it
 * anyway). TTL-retained entries are never victims — the registry
 * overflows instead (their retry would mint fresh and double-debit).
 */
function enforcePendingVtuCap(now: number = Date.now()): void {
  for (const [scoped, entry] of pendingVtuPurchases) {
    if (isExpiredPendingVtuEntry(entry, now)) {
      pendingVtuPurchases.delete(scoped);
      noteForgottenVtuScope(scoped, now, entry.key);
      return;
    }
  }
}

/** Records the key (cap-enforced); false when memory-only — dropped
 * AND the tombstone restored so a retry re-mints AND re-persists
 * (R96 P1, R99 P2 mobile mirror). */
export function rememberPendingVtuPurchase(
  payloadSignature: string,
  key: string,
  scopeTag?: string
): boolean {
  if (
    !pendingVtuPurchases.has(payloadSignature) &&
    pendingVtuPurchases.size >= MAX_PENDING_PURCHASES
  ) {
    enforcePendingVtuCap();
  }
  // Restored on persist failure below (Codex R99 P2, mobile
  // mirror): the old entry is only gone from storage when THIS
  // snapshot lands.
  const priorTombstone = forgottenScopedKeys.get(payloadSignature);
  pendingVtuPurchases.delete(payloadSignature);
  pendingVtuPurchases.set(payloadSignature, {
    key,
    reference: null,
    ...(scopeTag !== undefined ? { scopeTag } : {}),
    rememberedAt: Date.now(),
    completedAt: null,
  });
  forgottenScopedKeys.delete(payloadSignature);
  if (!persistPendingVtuPurchases()) {
    pendingVtuPurchases.delete(payloadSignature);
    if (priorTombstone !== undefined) {
      forgottenScopedKeys.set(payloadSignature, priorTombstone);
    }
    return false;
  }
  return true;
}

/** Attaches the server reference once a non-terminal response arrives. */
export function notePendingVtuReference(
  payloadSignature: string,
  reference: string
): void {
  const pending = pendingVtuPurchases.get(payloadSignature);
  if (pending) {
    pending.reference = reference;
    persistPendingVtuPurchases();
  }
}

/**
 * Records that terminal success was observed on a RETAINED entry (the
 * switched-success path, which notes without forgetting). Immediate
 * successes forget the entry instead, so they never need this. The
 * timestamp lets the stale predicate distinguish a slow first
 * completion (present it) from a repeat long after completion
 * ("Already Completed"). First observation wins: re-marking must not
 * extend the window.
 */
export function markPendingVtuCompleted(
  payloadSignature: string,
  now: number = Date.now()
): void {
  markPendingVtuCompletedIn(
    pendingVtuPurchases,
    persistPendingVtuPurchases,
    payloadSignature,
    now
  );
}

/**
 * Forgets retained entries by NOTED server reference. SHOWN-context
 * only (the voucher backfill, which just displayed the result): an
 * identical repeat is a new intent that must mint fresh and deliver
 * anew. Background passes MUST use markSettledPendingVtuByReference
 * instead — they observe terminality for results nobody saw, and
 * forgetting those would mint fresh on retry and debit twice (R68).
 */
export function forgetPendingVtuByReference(
  reference: string,
  now: number = Date.now()
): void {
  let touched = false;
  for (const [scoped, pending] of pendingVtuPurchases) {
    if (pending.reference !== reference) {
      continue;
    }
    pendingVtuPurchases.delete(scoped);
    noteForgottenVtuScope(scoped, now, pending.key);
    touched = true;
  }
  if (touched) {
    persistPendingVtuPurchases();
  }
}

/**
 * Settles background-observed terminal successes WITHOUT deleting
 * (R68 6rwG9F). Marked (suppressed) entries are skipped — the stale
 * guard presents them on replay. Unmarked entries are marked with an
 * already-stale timestamp: the outcome was never shown in-session
 * (watched resolutions are forgotten by the backfill first), so the
 * retry is told "Already Completed" instead of double-charging.
 */
export function markSettledPendingVtuByReference(
  reference: string,
  now: number = Date.now()
): void {
  let touched = false;
  for (const pending of pendingVtuPurchases.values()) {
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

/**
 * True when this reference resolves a previously-noted processing
 * response: the purchase already fired a refresh (and remounts
 * refetch), so the displayed balance already reflects the debit and
 * callers must refresh for server truth instead of decrementing
 * locally a second time.
 */
export function hasNotedPendingVtuReference(
  payloadSignature: string,
  reference: string
): boolean {
  return hasNotedPendingVtuReferenceIn(
    pendingVtuPurchases,
    payloadSignature,
    reference
  );
}

/** Staleness predicate (contract in isStalePendingVtuSuccessIn). Callers MUST forget and prompt fresh. */
export function isStalePendingVtuSuccess(
  payloadSignature: string,
  reference: string,
  now: number = Date.now()
): boolean {
  return isStalePendingVtuSuccessIn(
    pendingVtuPurchases,
    payloadSignature,
    reference,
    now,
    PENDING_VTU_STALE_AFTER_MS
  );
}

export function forgetPendingVtuPurchase(payloadSignature: string): void {
  // Bind the deleted generation: a newer in-flight key under the
  // same scope must survive this tombstone in other tabs (Codex
  // R55 6rrMIj). Unknown scope (no live entry) degrades to a
  // keyless tombstone with timestamp arbitration.
  const pending = pendingVtuPurchases.get(payloadSignature);
  pendingVtuPurchases.delete(payloadSignature);
  noteForgottenVtuScope(payloadSignature, Date.now(), pending?.key);
  persistPendingVtuPurchases();
}

/**
 * Settles ONE shown generation (Codex R137 P1): the backfill's
 * reference-forget already deleted it, and the success view's
 * settle runs after a render commit — so a newer same-scope key
 * minted cross-tab in between may already be live (imported by the
 * first forget's syncing persist). Deleting by scope here would
 * reap that newer generation (or write a keyless tombstone over
 * it); its retry would then mint fresh and debit twice. Instead
 * delete only the named generation and tombstone exactly it — a
 * newer key survives both the delete and the tombstone (key-bound
 * merge/delete in the sync module).
 */
export function forgetPendingVtuPurchaseGeneration(
  payloadSignature: string,
  key: string
): void {
  const live = pendingVtuPurchases.get(payloadSignature);
  if (live === undefined || live.key === key) {
    pendingVtuPurchases.delete(payloadSignature);
  }
  noteForgottenVtuScope(payloadSignature, Date.now(), key);
  persistPendingVtuPurchases();
}

/**
 * Recalled key, else mint + remember (mobile mirror). Throws when
 * the minted key is memory-only (R96 P1): aborts pre-POST, retry
 * re-mints once storage works. Recalled keys are already durable.
 */
export function getPendingVtuKey(
  payloadSignature: string,
  scopeTag?: string
): string {
  const recalled = recallPendingVtuKey(payloadSignature);
  if (recalled) {
    return recalled;
  }
  const minted = createWalletIdempotencyKey();
  if (!rememberPendingVtuPurchase(payloadSignature, minted, scopeTag)) {
    throw new Error(
      'Could not save this purchase for retry. Please check your browser storage and try again.'
    );
  }
  return minted;
}

/**
 * Noted server references across live entries (cross-tab synced).
 * The retained-settlement hook reads history for these when the
 * purchase modal opens (Codex R57 6rseWu). Reference-less entries
 * are excluded (nothing to look up). With a scope tag, tagged
 * entries for OTHER owners are excluded too — untagged (legacy)
 * entries fail open, since their owner is unknowable (R62 6rtokd).
 */
export function listNotedPendingVtuReferences(scopeTag?: string): string[] {
  syncPendingVtuPurchasesFromSnapshot();
  return listNotedPendingVtuReferencesFrom(
    pendingVtuPurchases.values(),
    scopeTag
  );
}

/** Test-only escape hatch: module state survives across renderHook mounts. */
export function clearPendingVtuKeys(): void {
  pendingVtuPurchases.clear();
  forgottenScopedKeys.clear();
  clearPendingVtuSnapshot();
}
