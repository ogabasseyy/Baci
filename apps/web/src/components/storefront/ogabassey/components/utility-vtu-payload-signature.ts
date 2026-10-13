import {
  canonicalizeVtuRetryIdentity,
  type VtuRetryIdentityField,
} from '@baci/shared';
import type { UtilityCheckoutPayload } from './utility-checkout';

export interface UtilityCheckoutWalletPayloadInput {
  merchantSlug: string;
  customerName: string;
  customerPhone: string | null | undefined;
  expectedUserId: string | null | undefined;
  payload: UtilityCheckoutPayload;
}

/**
 * The exact POST body submitUtilityCheckout sends: shared so the
 * pre-readiness retained peek signs the SAME object the submit
 * signs. An inline copy here would drift (peek misses, the retry
 * re-hits the balance gate) the next time either side changes.
 */
export function buildUtilityCheckoutWalletPayload({
  merchantSlug,
  customerName,
  customerPhone,
  expectedUserId,
  payload,
}: UtilityCheckoutWalletPayloadInput): Record<string, unknown> {
  return {
    merchantSlug,
    customerName,
    ...(customerPhone ? { customerPhone } : {}),
    ...(expectedUserId ? { expectedUserId } : {}),
    ...payload,
    walletAmount: payload.amount,
  };
}

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
