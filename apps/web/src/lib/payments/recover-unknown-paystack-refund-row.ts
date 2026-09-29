import type { SupabaseClient } from '@supabase/supabase-js';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { holdPaystackRefundForReview } from './hold-paystack-refund-for-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import type { RefundRow } from './paystack-cancellation-refund-row';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';

export async function lookupLocalRefundByProviderId(
  supabase: SupabaseClient,
  refundId: number
): Promise<RefundRow | null> {
  const { data, error } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway_reference, amount, currency, metadata, status'
    )
    .eq('transaction_type', 'refund')
    .eq('gateway', 'paystack')
    .eq('gateway_reference', String(refundId))
    .maybeSingle();
  if (error) throw new Error('refund_event_lookup_failed');
  return (data as RefundRow | null) ?? null;
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
