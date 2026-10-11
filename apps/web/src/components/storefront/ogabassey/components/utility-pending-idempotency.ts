import { createWalletIdempotencyKey } from './utility-checkout';

/**
 * Cross-mount recall for wallet-only VTU idempotency keys (web).
 *
 * The key used to live in a `useUtilityPurchase` ref, so closing the
 * processing screen with Done unmounted it: reopening Utilities and
 * resubmitting the same purchase minted a fresh key and the server
 * debited a SECOND transaction. This module-level registry survives
 * remounts within the session, so a retry of the same purchase reuses
 * its key and the route's `vtu_idempotency_keys` row dedupes (returning
 * the live transaction state) instead of double-charging.
 *
 * Entries are keyed by the canonical purchase signature (mirroring the
 * server fingerprint), additionally scoped to the authenticated owner +
 * merchant (the signature itself omits identity, like the server hash):
 * same signature in means the same payload out, so recall can never
 * attach a key to a different purchase — and the server's 409 guard
 * stays the backstop if they ever diverge. Terminal outcomes
 * (success, key-rotating 4xx) MUST forget the signature, or a later
 * legitimate repeat purchase would reattach to a dead key.
 *
 * Durability matches the ref it replaces: in-memory only. A full page
 * reload still loses pending keys (reload recovery is a separate
 * feature); this closes the remount gap, not the reload gap.
 */

/** Sequential web UX never has more than a couple of pendings in flight. */
const MAX_PENDING_PURCHASES = 32;

// Lockstep with the server fingerprint
// (`apps/web/src/lib/vtu-wallet-fingerprint.ts`): any field the server
// hashes that is missing here could attach one key to two payloads the
// server considers different (409 loop); any extra field here —
// cosmetic `customerName`/`customerPhone`, `merchantSlug`,
// `customerAddress` — could miss a legitimate retry when hydration or
// a profile update changes it between a timed-out submit and the
// retry (fresh key, double charge).
const SIGNATURE_FIELDS = [
  'amount',
  'billItemIdentifier',
  'billerCode',
  'billerName',
  'customerIdentifier',
  'dataPlanCode',
  'networkProvider',
  'phoneNumber',
  'productCode',
  'provider',
  'requireValidationRef',
  'type',
  'validationReference',
  'walletAmount',
] as const;

/**
 * Canonical retry signature for a wallet-only VTU payload. Field order
 * is fixed and absent values normalize to null (mirroring the
 * server's `?? null`), so two identical intents always sign
 * identically regardless of key insertion order.
 */
export function buildVtuWalletPayloadSignature(
  payload: Record<string, unknown>
): string {
  const canonical: Record<string, unknown> = {};
  for (const field of SIGNATURE_FIELDS) {
    canonical[field] = payload[field] ?? null;
  }
  return JSON.stringify(canonical);
}

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
}

const pendingPurchases = new Map<string, PendingVtuPurchase>();

// Owner scope for every registry entry. The signature deliberately
// omits identity (mirroring the server fingerprint), so without this a
// sign-out + second customer could recall the first customer's key for
// the same purchase — and the route rejects it as belonging to another
// customer. The purchase hook sets the scope from auth state on every
// render; a single session has a single identity, so last-write is
// always the current owner.
let ownerScope = '::';

export function setPendingVtuOwnerScope(
  ownerId: string | null | undefined,
  merchantId: string | null | undefined
): void {
  ownerScope = `${merchantId ?? ''}:${ownerId ?? ''}:`;
}

function scopedSignature(payloadSignature: string): string {
  return `${ownerScope}${payloadSignature}`;
}

export function recallPendingVtuKey(
  payloadSignature: string
): string | undefined {
  return pendingPurchases.get(scopedSignature(payloadSignature))?.key;
}

export function rememberPendingVtuPurchase(
  payloadSignature: string,
  key: string
): void {
  const scoped = scopedSignature(payloadSignature);
  if (!pendingPurchases.has(scoped) && pendingPurchases.size >= MAX_PENDING_PURCHASES) {
    // Drop the oldest entry rather than growing without bound; the
    // evicted purchase falls back to minting a fresh key on retry.
    const oldest = pendingPurchases.keys().next();
    if (!oldest.done) {
      pendingPurchases.delete(oldest.value);
    }
  }
  pendingPurchases.delete(scoped);
  pendingPurchases.set(scoped, {
    key,
    reference: null,
    rememberedAt: Date.now(),
  });
}

/** Attaches the server reference once a non-terminal response arrives. */
export function notePendingVtuReference(
  payloadSignature: string,
  reference: string
): void {
  const pending = pendingPurchases.get(scopedSignature(payloadSignature));
  if (pending) pending.reference = reference;
}

/**
 * True when a success response replays an already-completed purchase
 * instead of resolving the current submit: same remembered reference,
 * but the original submit is older than the recall window. Callers
 * MUST forget the signature and prompt a fresh submit instead of
 * presenting the earlier vend as the new purchase. Reference-less
 * entries (network-error submits that never got a response) always
 * resolve normally — their first success IS the resolution.
 */
export function isStalePendingVtuSuccess(
  payloadSignature: string,
  reference: string,
  now: number = Date.now()
): boolean {
  const pending = pendingPurchases.get(scopedSignature(payloadSignature));
  return (
    pending?.reference === reference &&
    now - pending.rememberedAt > PENDING_VTU_STALE_AFTER_MS
  );
}

export function forgetPendingVtuPurchase(payloadSignature: string): void {
  pendingPurchases.delete(scopedSignature(payloadSignature));
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
  pendingPurchases.clear();
}
