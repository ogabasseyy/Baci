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
 * Entries are keyed by the purchase payload signature (`JSON.stringify`
 * of the wallet payload, built identically on every submit), so recall
 * can never attach a key to a different purchase. Terminal outcomes
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

const pendingKeys = new Map<string, string>();

export function recallPendingVtuKey(
  payloadSignature: string
): string | undefined {
  return pendingKeys.get(payloadSignature);
}

export function rememberPendingVtuPurchase(
  payloadSignature: string,
  key: string
): void {
  if (
    !pendingKeys.has(payloadSignature) &&
    pendingKeys.size >= MAX_PENDING_PURCHASES
  ) {
    // Drop the oldest entry rather than growing without bound; the
    // evicted purchase falls back to minting a fresh key on retry.
    const oldest = pendingKeys.keys().next();
    if (!oldest.done) {
      pendingKeys.delete(oldest.value);
    }
  }
  pendingKeys.set(payloadSignature, key);
}

export function forgetPendingVtuPurchase(payloadSignature: string): void {
  pendingKeys.delete(payloadSignature);
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
  pendingKeys.clear();
}
