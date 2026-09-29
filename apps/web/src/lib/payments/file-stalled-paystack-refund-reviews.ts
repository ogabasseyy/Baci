import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { fileCancelledPaystackRefundCandidateReviews } from './file-cancelled-paystack-refund-candidate-reviews';
import type { RefundRecoveryEvidence } from './file-paystack-refund-candidate-reviews';
import { fileActiveOrderPaystackRefundCandidateReviews } from './file-provider-refund-outside-cancellation-review';

interface StalledPayment {
  amount: number;
  gateway_reference: string | null;
  id: string;
  merchant_id: string;
  order_id: string | null;
}

/**
 * Retain verified provider evidence when no completed local payment
 * matches: a stale pending attempt may already have captured and been
 * refunded before the sweep examined it. Every stalled match is fetched
 * (no LIMIT) so a repeated reference cannot drop an order silently.
 * Cancelled-order matches file into the cancellation queue; a refund
 * for a stale payment on an active order is merchant evidence, so it
 * files into the non-cancellation queue instead — acknowledging it
 * with neither review nor local refund row would let a later charge
 * recovery mark the order paid even though the customer was refunded.
 */
export async function fileStalledPaystackRefundReviews(
  supabase: SupabaseClient,
  {
    evidence,
    gatewayReference,
    refund,
    refundId,
  }: {
    evidence: RefundRecoveryEvidence;
    gatewayReference: string;
    refund: { amount: number; currency: string; status: string };
    refundId: number;
  }
): Promise<void> {
  const { data: stalledRows, error: stalledError } = await supabase
    .from('transactions')
    .select('id, order_id, merchant_id, gateway_reference, amount')
    .eq('gateway', 'paystack')
    .eq('gateway_reference', gatewayReference)
    .eq('transaction_type', 'payment')
    .in('status', ['pending', 'processing', 'failed']);
  if (stalledError) throw new Error('refund_event_payment_lookup_failed');
  const stalled = (stalledRows ?? []) as StalledPayment[];
  if (stalled.length === 0) {
    logger.info({
      message:
        'Unknown Paystack refund event matches no single completed payment',
      refundId,
    });
    return;
  }
  const reason = `Paystack refund ${refundId} matches a non-completed local payment for reference ${gatewayReference}`;
  await fileCancelledPaystackRefundCandidateReviews(
    supabase,
    stalled,
    evidence,
    reason
  );
  await fileActiveOrderPaystackRefundCandidateReviews(
    supabase,
    stalled,
    evidence,
    reason,
    refund
  );
  logger.info({
    message: 'Unknown Paystack refund event matches a non-completed payment',
    refundId,
  });
}
