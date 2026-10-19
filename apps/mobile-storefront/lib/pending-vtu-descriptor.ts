/**
 * Purchase descriptors for wallet-only VTU idempotency keys.
 *
 * Extracted from pending-vtu-idempotency.ts per the 300-line Boy
 * Scout Rule (Codex R55 6rrU6J): descriptor construction is pure —
 * no registry state — so it lives here while recall/forget stay in
 * the registry.
 */
import {
  canonicalizeVtuRetryIdentity,
  hashVtuScopeDescriptor,
} from '@baci/shared';

/**
 * Binds a descriptor to the submitting owner + merchant. Callers MUST
 * scope ONCE per submission: a module-global scope would let an
 * account switch redirect one customer's completion onto another's.
 * Returns the SHA-256 digest (not the raw scope string): the
 * descriptor embeds recipient identifiers and the digest keeps them
 * out of the live map and the MMKV snapshot at rest.
 */
export function scopePendingVtuKey(
  ownerId: string | null | undefined,
  merchantId: string | null | undefined,
  descriptor: string
): string {
  return hashVtuScopeDescriptor(
    `${merchantId ?? ''}:${ownerId ?? ''}:${descriptor}`
  );
}

/**
 * Canonical descriptor for a wallet-only VTU payload, derived from
 * the shared retry-identity module (same field list the server
 * hashes — see its doc for the lockstep rationale). Field order is
 * fixed and absent values normalize to null, so two identical
 * payloads always describe identically regardless of key insertion
 * order.
 */
export function buildVtuPurchaseDescriptor(
  payload: Record<string, unknown>
): string {
  return JSON.stringify(canonicalizeVtuRetryIdentity(payload));
}
