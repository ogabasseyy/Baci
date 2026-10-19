import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { handlePaymentForCancelledOrder } from '@/lib/payments/handle-payment-for-cancelled-order';

export interface WedgeCandidateRef {
  id: string;
  order_id: string;
  gateway: string;
  gateway_reference: string | null;
  metadata: Record<string, unknown> | null;
}

// A wedged payment leaves the hourly sweep for good only after ops can see
// it: file the reconciliation_review row FIRST, and stamp the transaction
// (which excludes it from the candidate query) only once that row is
// durable. A transient review-insert failure therefore keeps the payment in
// the batch for the next run instead of retiring it silently.
export async function retireWedgeWithReview({
  candidate,
  reason,
  resolution,
  supabase,
}: {
  candidate: WedgeCandidateRef;
  reason: string;
  resolution: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  const filed = await handlePaymentForCancelledOrder({
    gatewayReference: candidate.gateway_reference,
    issueType: 'gateway_payment_wedge_requires_review',
    order: { id: candidate.order_id },
    reason,
    transactionId: candidate.id,
  });
  if (!filed) {
    logger.error({
      message:
        'Wedge sweep could not file a reconciliation review; leaving the payment in the batch',
      orderId: candidate.order_id,
      transactionId: candidate.id,
    });
    return false;
  }
  return stampWedgeResolution(supabase, candidate, resolution);
}

// Terminal outcomes are stamped so the hourly query never recycles them.
// The stamp merges database-side: spreading the stale in-memory metadata
// snapshot would clobber a concurrent charge.success completion and erase
// the abandoned_sweep_resolution a duplicate-capture filing just stamped.
export async function stampWedgeResolution(
  supabase: SupabaseClient,
  candidate: WedgeCandidateRef,
  resolution: string
): Promise<boolean> {
  const { data: stamped, error } = await supabase.rpc(
    'stamp_wedge_sweep_resolution_v1',
    {
      p_transaction_id: candidate.id,
      p_resolution: resolution,
    }
  );
  if (error || stamped !== true) {
    // Non-fatal: the row shows up again next hour.
    logger.warn({
      error,
      message: 'Failed to stamp wedge sweep resolution',
      transactionId: candidate.id,
    });
    return false;
  }
  return true;
}
