/**
 * Refund projection for the customer VTU history response.
 *
 * Lives here (not in the history route) per the Boy Scout Rule: that
 * module is already beyond the 300-line budget. The wallet-only
 * success view polls these fields to decide when a failed purchase
 * is truly settled.
 */
export interface HistoryRefundProjection {
  /**
   * Failed + debited + refund not yet issued. Failed persists BEFORE
   * the refund RPC runs, so clients must keep polling (and never
   * claim the refund) until this clears; the cron confirms it.
   */
  refund_pending: boolean;
  /**
   * Total amount restored to the wallet, or null when unknown/none.
   * The persisted `refundAmount` is the CARD leg only (0 for
   * wallet-only); the reversed wallet leg comes from the purchase
   * split, so the projection sums both — otherwise wallet-only
   * failures would report "₦0 refunded" for a full restoration.
   */
  refunded_to_wallet: number | null;
}

interface RefundMetadataShape {
  paymentSplit?: unknown;
  refundAmount?: unknown;
  refundIssued?: unknown;
  walletDebited?: unknown;
}

export function projectHistoryRefundFields({
  metadata,
  status,
}: {
  metadata: Record<string, unknown> | null | undefined;
  status: unknown;
}): HistoryRefundProjection {
  const shape = (metadata ?? {}) as RefundMetadataShape;
  const walletDebited = shape.walletDebited === true;
  const refundIssued = shape.refundIssued === true;
  const cardLeg =
    refundIssued && typeof shape.refundAmount === 'number'
      ? shape.refundAmount
      : 0;
  const split = shape.paymentSplit as
    | { wallet?: unknown; card?: unknown }
    | undefined;
  const walletLeg =
    walletDebited && typeof split?.wallet === 'number' ? split.wallet : 0;
  const totalRestored = cardLeg + walletLeg;
  return {
    refund_pending: status === 'failed' && walletDebited && !refundIssued,
    refunded_to_wallet:
      refundIssued && totalRestored > 0 ? totalRestored : null,
  };
}
