import {
  canonicalizeVtuRetryIdentity,
  type VtuRetryIdentityField,
} from '@baci/shared';

/**
 * Canonical retry signature for a wallet-only VTU payload, derived
 * from the shared retry-identity module (same field list the server
 * hashes — see its doc for the lockstep rationale). Field order is
 * fixed and absent values normalize to null, so two identical
 * intents always sign identically regardless of key insertion order.
 */
export function buildVtuWalletPayloadSignature(
  payload: Record<VtuRetryIdentityField | string, unknown>
): string {
  return JSON.stringify(canonicalizeVtuRetryIdentity(payload));
}
