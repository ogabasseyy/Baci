import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { fileCancelledPaystackRefundCandidateReviews } from './file-cancelled-paystack-refund-candidate-reviews';
import type { RefundRecoveryEvidence } from './file-paystack-refund-candidate-reviews';
import { fileActiveOrderPaystackRefundCandidateReviews } from './file-provider-refund-outside-cancellation-review';

export interface StalledPayment {
  amount: number;
  gateway_reference: string | null;
  id: string;
  merchant_id: string;
  order_id: string | null;
}

const STALLED_MATCH_PAGE_SIZE = 10;

/**
 * Retain verified provider evidence when no completed local payment
 * matches: a stale pending attempt may already have captured and been
 * refunded before the sweep examined it. A corrupt or legacy reference
 * can be shared by more stalled payments than the PostgREST response
 * cap, so every match is paginated in stable id order before filing —
 * acknowledging a truncated subset would permanently drop the omitted
 * orders' verified evidence. Cancelled-order matches file into the
 * cancellation queue; a refund for a stale payment on an active order
 * is merchant evidence, so it files into the non-cancellation queue
 * instead — acknowledging it with neither review nor local refund row
 * would let a later charge recovery mark the order paid even though
 * the customer was refunded. Returns the number of stalled matches
 * filed so the caller can recheck completed payments when both scans
 * are empty (a concurrent charge webhook may have completed the
 * payment between the two reads).
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
): Promise<number> {
  const stalled: StalledPayment[] = [];
  for (let offset = 0; ; offset += STALLED_MATCH_PAGE_SIZE) {
    const { data: stalledRows, error: stalledError } = await supabase
      .from('transactions')
      .select('id, order_id, merchant_id, gateway_reference, amount')
      .eq('gateway', 'paystack')
      .eq('gateway_reference', gatewayReference)
      .eq('transaction_type', 'payment')
      .in('status', ['pending', 'processing', 'failed'])
      .order('id', { ascending: true })
      .range(offset, offset + STALLED_MATCH_PAGE_SIZE - 1);
    if (stalledError) throw new Error('refund_event_payment_lookup_failed');
    const page = (stalledRows ?? []) as StalledPayment[];
    stalled.push(...page);
    if (page.length < STALLED_MATCH_PAGE_SIZE) break;
  }
  if (stalled.length === 0) {
    logger.info({
      message:
        'Unknown Paystack refund event matches no single completed payment',
      refundId,
    });
    return 0;
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
  return stalled.length;
}
