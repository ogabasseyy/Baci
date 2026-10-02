import type { SupabaseClient } from '@supabase/supabase-js';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { holdPaystackRefundForReview } from './hold-paystack-refund-for-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import { normalizePaymentGateway } from './normalize-payment-gateway';
import type { RefundRow } from './paystack-cancellation-refund-row';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';

export async function lookupLocalRefundByProviderId(
  supabase: SupabaseClient,
  refundId: number
): Promise<RefundRow | null> {
  // Legacy rows may pad or re-case the gateway (` Paystack `): an
  // exact match misses the raced audit row and files a generic
  // review instead of reconciling it. Prefilter case-insensitively
  // server-side, then exact-normalize like the webhook lookup.
  const { data, error } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway, gateway_reference, amount, currency, metadata, status'
    )
    .eq('transaction_type', 'refund')
    .ilike('gateway', '%paystack%')
    .eq('gateway_reference', String(refundId))
    .limit(2);
  if (error) throw new Error('refund_event_lookup_failed');
  const matches = ((data ?? []) as RefundRow[]).filter(
    (row) =>
      normalizePaymentGateway((row as { gateway?: unknown }).gateway) ===
      'PAYSTACK'
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
