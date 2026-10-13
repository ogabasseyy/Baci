import { hashVtuScopeDescriptor } from '@baci/shared';

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
 *
 * Split from utility-pending-idempotency.ts per the 300-line budget
 * (Codex R68 6rwG9F); pure, no registry state.
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
