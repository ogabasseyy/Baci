import type { SupabaseClient } from '@supabase/supabase-js';
import { DeliveryUncertainError } from '@/lib/orders/run-order-cancellation-side-effect';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';

export async function quarantineRefund({
  metadata,
  order,
  preflight = false,
  reason,
  supabase,
  transactions,
}: {
  metadata?: Record<string, unknown>;
  order: { currency: string | null; id: string; merchant_id: string };
  /**
   * Set when no provider refund was initiated in this run, so a transient
   * review-write failure stays retryable instead of quarantining the step.
   */
  preflight?: boolean;
  reason: string;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transactions: GatewayPaymentTransaction[];
}): Promise<never> {
  const firstTransaction = transactions[0];
  const { error: reviewError } = await supabase
    .from('reconciliation_review')
    .insert({
      candidates: transactions.map((transaction) => ({
        amount: Number(transaction.amount),
        currency: transaction.currency ?? order.currency ?? 'NGN',
        gateway: transaction.gateway,
        gatewayReference: transaction.gateway_reference,
        paymentTransactionId: transaction.id,
      })),
      issue_type: 'order_cancellation_refund_requires_review',
      merchant_id: order.merchant_id,
      metadata: metadata ?? {},
      order_id: order.id,
      paystack_ref: firstTransaction?.gateway_reference ?? null,
      reason,
      txn_id: firstTransaction?.id ?? null,
    });
  const duplicateReview =
    (reviewError as { code?: string } | null)?.code === '23505';
  if (duplicateReview) {
    // An open review already covers this order. When this quarantine carries
    // provider-accepted refund evidence with no local row, merge it into the
    // existing review instead of dropping the recovery metadata.
    const providerRefundId = metadata?.provider_refund_id;
    const paymentTransactionId = metadata?.payment_transaction_id;
    if (
      typeof providerRefundId === 'number' &&
      Number.isSafeInteger(providerRefundId) &&
      providerRefundId > 0 &&
      typeof paymentTransactionId === 'string' &&
      paymentTransactionId.length > 0
    ) {
      const { data: merged, error: mergeError } = await supabase.rpc(
        'merge_paystack_cancellation_refund_provider_evidence_v1',
        {
          p_order_id: order.id,
          p_merchant_id: order.merchant_id,
          p_provider_refund_id: providerRefundId,
          p_payment_transaction_id: paymentTransactionId,
          p_reason: reason,
        }
      );
      if (mergeError || merged !== true) {
        if (preflight) {
          throw new Error(
            'Refund requires reconciliation, but merging its recovery evidence failed'
          );
        }
        throw new DeliveryUncertainError(
          'Refund requires reconciliation, but merging its recovery evidence failed'
        );
      }
    }
  }
  if (reviewError && !duplicateReview) {
    if (preflight) {
      throw new Error(
        'Refund requires reconciliation, but filing the review failed'
      );
    }
    // A provider refund may already exist; never make review-write failure retryable.
    throw new DeliveryUncertainError(
      'Refund requires reconciliation, but filing the review failed'
    );
  }
  throw new DeliveryUncertainError(reason);
}
