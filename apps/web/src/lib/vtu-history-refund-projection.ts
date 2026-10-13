/**
 * Refund projection for the customer VTU history response.
 *
 * Lives here (not in the history route) per the Boy Scout Rule: that
 * module is already beyond the 300-line budget. The wallet-only
 * success view polls these fields to decide when a failed purchase
 * is truly settled.
 */
import { VTU_REFUND_SKIPPED_NO_COLLECTION } from '@/lib/vtu-refund-collection-evidence';
import { requiresVtuCustomerWalletRefund } from '@/lib/vtu-refund-guard';

export interface HistoryRefundProjection {
  /**
   * Failed + refund-required + refund not yet issued. Failed persists
   * BEFORE the refund RPC runs, so clients must keep polling (and
   * never claim the refund) until this clears; the cron confirms it.
   * Gated on requiresVtuCustomerWalletRefund — NOT on the wallet
   * debit marker — so legacy card-only failures (no split, no marker)
   * stay pending until refundCardOnly lands instead of reporting an
   * explicit false the pollers read as refund proof.
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
  refundSkipped?: unknown;
  walletDebited?: unknown;
}

export function projectHistoryRefundFields({
  metadata,
  row,
  status,
}: {
  metadata: Record<string, unknown> | null | undefined;
  row: {
    amount: unknown;
    customer_id: unknown;
    id: unknown;
    source: unknown;
  };
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
  // PostgREST returns numerics as strings; requires() needs a number.
  const amount = Number(row.amount);
  // A deliberate no-evidence skip is terminally failed, not
  // awaiting a refund: pollers must stop, not spin forever.
  const refundSkipped =
    shape.refundSkipped === VTU_REFUND_SKIPPED_NO_COLLECTION;
  return {
    refund_pending:
      status === 'failed' &&
      !refundIssued &&
      !refundSkipped &&
      requiresVtuCustomerWalletRefund({
        amount: Number.isFinite(amount) ? amount : 0,
        customer_id:
          typeof row.customer_id === 'string' ? row.customer_id : null,
        id: typeof row.id === 'string' ? row.id : '',
        source: typeof row.source === 'string' ? row.source : null,
      }),
    refunded_to_wallet:
      refundIssued && totalRestored > 0 ? totalRestored : null,
  };
}
