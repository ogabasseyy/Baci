import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { fileCancelledPaystackRefundCandidateReviews } from './file-cancelled-paystack-refund-candidate-reviews';
import { fileUnclaimedPaystackRefundCandidateReview } from './file-invalid-paystack-refund-evidence-review';
import type { RefundRecoveryEvidence } from './file-paystack-refund-candidate-reviews';
import { fileActiveOrderPaystackRefundCandidateReviews } from './file-provider-refund-outside-cancellation-review';
import { normalizePaymentGateway } from './normalize-payment-gateway';

export interface StalledPayment {
  amount: number;
  gateway: string | null;
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
  // Keyset over the immutable id order: offsets over this
  // status-filtered set would shift when a lower-id row transitions
  // out of the stalled statuses between page reads, skipping a later
  // match — and finding any stalled rows returns without opening a
  // recovery watch, so the omitted order would keep no durable
  // refund evidence for the acknowledged webhook.
  let lastId: string | null = null;
  for (;;) {
    // Legacy rows may pad or re-case the gateway (` Paystack `):
    // prefilter case-insensitively server-side, then exact-normalize
    // the page so only genuine Paystack legs file.
    const filtered = supabase
      .from('transactions')
      .select('id, order_id, merchant_id, gateway, gateway_reference, amount')
      .ilike('gateway', '%paystack%')
      .eq('gateway_reference', gatewayReference)
      .eq('transaction_type', 'payment')
      .in('status', ['pending', 'processing', 'failed'])
      .order('id', { ascending: true });
    const { data: stalledRows, error: stalledError } = await (lastId === null
      ? filtered
      : filtered.gt('id', lastId)
    ).limit(STALLED_MATCH_PAGE_SIZE);
    if (stalledError) throw new Error('refund_event_payment_lookup_failed');
    const page = (stalledRows ?? []) as StalledPayment[];
    stalled.push(
      ...page.filter(
        (row) => normalizePaymentGateway(row.gateway) === 'PAYSTACK'
      )
    );
    if (page.length < STALLED_MATCH_PAGE_SIZE) break;
    lastId = page[page.length - 1]?.id ?? null;
    if (lastId === null) break;
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
  const cancelledFiled = await fileCancelledPaystackRefundCandidateReviews(
    supabase,
    stalled,
    evidence,
    reason
  );
  const activeFiled = await fileActiveOrderPaystackRefundCandidateReviews(
    supabase,
    stalled,
    evidence,
    reason,
    refund
  );
  // Order-less matches are skipped by both queues: file them
  // generically so the returned count (and the marker below) means
  // every match is durably retained, never silently dropped.
  await fileUnclaimedPaystackRefundCandidateReview(supabase, {
    candidates: stalled,
    evidence,
    filed: [cancelledFiled, activeFiled],
    reason,
    reference: gatewayReference,
    refundId,
  });
  logger.info({
    message: 'Unknown Paystack refund event matches a non-completed payment',
    refundId,
  });
  return stalled.length;
}
