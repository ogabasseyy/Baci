import { hashVtuScopeDescriptor } from '@baci/shared';
import { createWalletIdempotencyKey } from './utility-checkout';
import { clearPendingVtuSnapshot } from './utility-pending-idempotency-store';
import { PERSISTED_VTU_KEY_TTL_MS } from './utility-pending-vtu-codec';
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
 * snapshot. Terminal outcomes MUST forget, or a later repeat buy
 * reattaches to a dead key.
 *
 * Durability: localStorage (cross-tab) so reloads and new-tab
 * retries replay the same key. Uniform 7-day TTL everywhere
 * (persisted + live, any reference state); within it the 5-minute
 * stale window arbitrates success replays of noted references.
 *
 * State + cross-tab sync live in utility-pending-vtu-sync.ts (split
 * per the 300-line budget); this module owns the operations on top.
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
 * Binds a purchase signature to the submitting owner + merchant. The
 * signature deliberately omits identity (mirroring the server
 * fingerprint), so without this a sign-out + second customer could
 * recall the first customer's key for the same purchase — and the
 * route rejects it as belonging to another customer. Callers MUST
 * scope ONCE per submission and pass the scoped key to every registry
 * call: a module-global scope would let an account switch mid-flight
 * redirect one customer's completion onto another customer's entry.
 * Returns the SHA-256 digest (not the raw scope string): the
 * signature embeds recipient identifiers and the digest keeps them
 * out of the live map and the localStorage snapshot at rest.
 */
export function scopePendingVtuSignature(
  ownerId: string | null | undefined,
  merchantId: string | null | undefined,
  payloadSignature: string
): string {
  return hashVtuScopeDescriptor(
    `${merchantId ?? ''}:${ownerId ?? ''}:${payloadSignature}`
  );
}

/**
 * Key previously used for this exact purchase, if it is still pending.
 * Entries past the 7-day TTL are dropped instead of recalled — including
 * referenced ones. No client-side signal proves terminality (noted
 * references mark non-terminal processing responses, and the server
 * leaves unconfirmed rows processing indefinitely), so retention is
 * horizon-based: 7 days dwarf any plausible processing duration, while
 * infinite retention would accumulate unboundedly and wedge the cap.
 * The 5min stale check still arbitrates success replays within the TTL.
 */
export function recallPendingVtuKey(
  payloadSignature: string,
  now: number = Date.now()
): string | undefined {
  syncPendingVtuPurchasesFromSnapshot();
  const pending = pendingVtuPurchases.get(payloadSignature);
  if (!pending) return undefined;
  if (now - pending.rememberedAt > PERSISTED_VTU_KEY_TTL_MS) {
    pendingVtuPurchases.delete(payloadSignature);
    noteForgottenVtuScope(payloadSignature, now, pending.key);
    persistPendingVtuPurchases();
    return undefined;
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
  for (const [scoped, entry] of pendingVtuPurchases) {
    if (now - entry.rememberedAt > PERSISTED_VTU_KEY_TTL_MS) {
      pendingVtuPurchases.delete(scoped);
      noteForgottenVtuScope(scoped, now, entry.key);
      return;
    }
  }
}

export function rememberPendingVtuPurchase(
  payloadSignature: string,
  key: string
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
 * Forgets retained entries by NOTED server reference. The settlement
 * pollers learn terminality from history — not from a response — so
 * they know the reference but not the signature. Terminality always
 * forgets (mirroring the view's settle-on-success): the success is
 * SHOWN, so an identical repeat is a new intent that must mint fresh
 * and deliver anew — keeping the key would present the previous vend
 * as the new purchase without delivering anything. (Marking is
 * reserved for UNSHOWN completions on the switched path, where the
 * stale guard arbitrates replays.)
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
export function getPendingVtuKey(payloadSignature: string): string {
  const recalled = recallPendingVtuKey(payloadSignature);
  if (recalled) {
    return recalled;
  }
  const minted = createWalletIdempotencyKey();
  rememberPendingVtuPurchase(payloadSignature, minted);
  return minted;
}

/** Test-only escape hatch: module state survives across renderHook mounts. */
export function clearPendingVtuKeys(): void {
  pendingVtuPurchases.clear();
  forgottenScopedKeys.clear();
  clearPendingVtuSnapshot();
}
