/**
 * Cross-mount recall for wallet-only VTU idempotency keys.
 *
 * The key used to live in a `useUtilityPayment` ref, so navigating away
 * from a `202 processing` view ("Back to Home") and reopening Utilities
 * remounted the form with an empty key: resubmitting the same recipient
 * minted a fresh UUID and the server debited a SECOND transaction. This
 * module-level registry survives remounts within the session, so a retry
 * of the same purchase reuses its key and the route's
 * `vtu_idempotency_keys` row dedupes (returning the live transaction
 * state) instead of double-charging.
 *
 * Entries are keyed by a canonical purchase descriptor mirroring the
 * server fingerprint (`apps/web/src/lib/vtu-wallet-fingerprint.ts`):
 * same descriptor in means the same payload out, so recall can never
 * attach a key to a different purchase — and the server's 409 guard
 * stays the backstop if they ever diverge. Terminal outcomes
 * (success, key-rotating 4xx) MUST forget the descriptor, or a later
 * legitimate repeat purchase would reattach to a dead key.
 *
 * Durability matches the ref it replaces: in-memory only. An app
 * restart still loses pending keys (restart recovery is a separate
 * feature); this closes the remount gap, not the relaunch gap.
 */

// Lockstep with the server fingerprint fields: any field the server
// hashes that is missing here could attach one key to two payloads
// the server considers different (409 loop); any extra field here
// could miss a legitimate retry (fresh key, double charge).
const DESCRIPTOR_FIELDS = [
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

/** Sequential mobile UX never has more than a couple of pendings in flight. */
const MAX_PENDING_PURCHASES = 32;

const pendingKeys = new Map<string, string>();

/**
 * Canonical descriptor for a wallet-only VTU payload. Field order is
 * fixed and absent values normalize to null (mirroring the server's
 * `?? null`), so two identical payloads always describe identically
 * regardless of key insertion order.
 */
export function buildVtuPurchaseDescriptor(
  payload: Record<string, unknown>
): string {
  const canonical: Record<string, unknown> = {};
  for (const field of DESCRIPTOR_FIELDS) {
    canonical[field] = payload[field] ?? null;
  }
  return JSON.stringify(canonical);
}

/** Key previously used for this exact purchase, if it is still pending. */
export function recallPendingVtuKey(descriptor: string): string | null {
  return pendingKeys.get(descriptor) ?? null;
}

/**
 * Records the key a purchase was submitted with. Oldest entries evict
 * past the cap — eviction only drops the client recall (the server
 * dedupe row is unaffected), and 32 outstanding pendings is unreachable
 * through sequential taps.
 */
export function rememberPendingVtuPurchase(
  descriptor: string,
  key: string
): void {
  pendingKeys.delete(descriptor);
  pendingKeys.set(descriptor, key);
  while (pendingKeys.size > MAX_PENDING_PURCHASES) {
    const oldest = pendingKeys.keys().next();
    if (oldest.done) break;
    pendingKeys.delete(oldest.value);
  }
}

/** Drops the recall entry once its purchase reaches a terminal outcome. */
export function forgetPendingVtuPurchase(descriptor: string): void {
  pendingKeys.delete(descriptor);
}
