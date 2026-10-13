import type { SupabaseClient } from '@supabase/supabase-js';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { findPaystackRefundRowsByProviderId } from './find-paystack-refund-rows-by-provider-id';
import { holdPaystackRefundForReview } from './hold-paystack-refund-for-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import type { RefundRow } from './paystack-cancellation-refund-row';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';

export async function lookupLocalRefundByProviderId(
  supabase: SupabaseClient,
  refundId: number
): Promise<RefundRow | null> {
  const matches = await findPaystackRefundRowsByProviderId<RefundRow>(
    supabase,
    refundId,
    'id, order_id, merchant_id, gateway, gateway_reference, amount, currency, metadata, status'
  );
  // Duplicate audit rows for one provider refund: never guess —
  // fail like the old maybeSingle multi-row error.
  if (matches.length > 1) throw new Error('refund_event_lookup_failed');
  return matches[0] ?? null;
}

export async function reconcileRecoveredRow(
  supabase: SupabaseClient,
  refund: RefundRow
): Promise<void> {
  try {
    await reconcilePaystackCancellationRefund(supabase, refund);
  } catch (reason) {
    if (!isDeterministicRefundError(reason)) throw reason;
    await fileRefundEvidenceReview(supabase, refund, reason.message);
    await holdPaystackRefundForReview(supabase, refund.id, reason.message);
  }
}
