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
 * signs. An inline copy would drift (peek misses, the retry
 * re-hits the balance gate) the next time either side changes.
 * Own module per the one-export-per-file rule (Codex R66 6rvh_H).
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
