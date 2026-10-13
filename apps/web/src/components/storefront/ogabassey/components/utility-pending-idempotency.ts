import { createWalletIdempotencyKey } from './utility-checkout';
import { clearPendingVtuSnapshot } from './utility-pending-idempotency-store';
import { isExpiredPendingVtuEntry } from './utility-pending-vtu-codec';
import {
  forgottenScopedKeys,
  noteForgottenVtuScope,
  pendingVtuPurchases,
  persistPendingVtuPurchases,
  syncPendingVtuPurchasesFromSnapshot,
} from './utility-pending-vtu-sync';

/**
 * Cross-mount recall for wallet-only VTU idempotency keys (web). The
 * key used to live in a ref, so Done + resubmit minted fresh and the
 * server debited a SECOND transaction. This module registry survives
 * remounts, so retries reuse the key and the route's idempotency row
 * dedupes instead of double-charging.
 *
 * Entries key by canonical purchase signature (server-fingerprint
 * mirror), scoped to owner + merchant then SHA-256 digested: same
 * signature in means the same payload out, with the server 409 guard
 * as backstop, and no recipient identifier rests in the map or the
 * snapshot. Deletion rule (R68 6rwG9F): only a view that just showed
 * a result may forget it; background passes mark successes stale
 * instead, so suppressed outcomes replay instead of double-charging.
 *
 * Durability: localStorage (cross-tab) so reloads and new-tab
 * retries replay the same key. Uniform 7-day TTL everywhere
 * (persisted + live, any reference state); within it the 5-minute
 * stale window arbitrates success replays of noted references.
 *
 * Sync + scoping live in utility-pending-vtu-sync.ts and
 * utility-pending-vtu-scope.ts; ops live here.
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

export function rememberPendingVtuPurchase(
  payloadSignature: string,
  key: string,
  scopeTag?: string
): void {
  if (
    !pendingVtuPurchases.has(payloadSignature) &&
    pendingVtuPurchases.size >= MAX_PENDING_PURCHASES
  ) {
    enforcePendingVtuCap();
  }
  pendingVtuPurchases.delete(payloadSignature);
  pendingVtuPurchases.set(payloadSignature, {
    key,
    reference: null,
    ...(scopeTag !== undefined ? { scopeTag } : {}),
    rememberedAt: Date.now(),
    completedAt: null,
  });
  forgottenScopedKeys.delete(payloadSignature);
  persistPendingVtuPurchases();
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
  const pending = pendingVtuPurchases.get(payloadSignature);
  if (pending && pending.completedAt === null) {
    pending.completedAt = now;
    persistPendingVtuPurchases();
  }
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
  return pendingVtuPurchases.get(payloadSignature)?.reference === reference;
}

/**
 * True when a success response replays an already-completed purchase
 * instead of resolving the current submit: same NOTED reference AND
 * completion was observed longer ago than the recall window, so this
 * submit is a NEW intent, not a retry. Callers MUST forget the
 * signature and prompt a fresh submit instead of presenting the
 * earlier vend as the new purchase. Staleness keys off the COMPLETION
 * time, never the submit/noted time: a reference noted while
 * processing (or a completion observed seconds ago) is NOT stale, so
 * a slow first completion — e.g. via reconciliation minutes after a
 * 202 — is presented instead of misreported as "Already Completed"
 * (which would forget the key and double-debit the prompted retry).
 * Entries with no OBSERVED completion are NEVER stale. Past the TTL
 * recall already dropped them, so this predicate never sees them.
 */
export function isStalePendingVtuSuccess(
  payloadSignature: string,
  reference: string,
  now: number = Date.now()
): boolean {
  const pending = pendingVtuPurchases.get(payloadSignature);
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
 * Returns the recalled key for this purchase, minting and remembering a
 * fresh one on first submit. Mirrors mobile's
 * `getWalletIdempotencyKey(descriptor)`.
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
  rememberPendingVtuPurchase(payloadSignature, minted, scopeTag);
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
  // Deduped: several descriptors can note the same reference (and
  // unscoped test keys twin with their migrated digests after a
  // sync) — one history read per reference is enough.
  const references = new Set<string>();
  for (const entry of pendingVtuPurchases.values()) {
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

/** Test-only escape hatch: module state survives across renderHook mounts. */
export function clearPendingVtuKeys(): void {
  pendingVtuPurchases.clear();
  forgottenScopedKeys.clear();
  clearPendingVtuSnapshot();
}
