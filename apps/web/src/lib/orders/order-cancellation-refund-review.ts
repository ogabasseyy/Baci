import type { SupabaseClient } from '@supabase/supabase-js';
import { DeliveryUncertainError } from '@/lib/orders/run-order-cancellation-side-effect';

export interface GatewayPaymentTransaction {
  amount: number;
  currency: string | null;
  gateway: string | null;
  gateway_reference: string | null;
  id: string;
}

const INTERNAL_PAYMENT_GATEWAYS = new Set([
  'wallet',
  'savings',
  'store_credit',
  'cash',
  'manual',
  'pay_on_delivery',
]);

export function isExternalPaymentGateway(gateway: string | null): boolean {
  return !gateway || !INTERNAL_PAYMENT_GATEWAYS.has(gateway);
}

export function unsupportedRefundReasons(
  transactions: GatewayPaymentTransaction[]
): string[] {
  return [
    ...new Set(
      transactions.map((transaction) => {
        if (!transaction.gateway) return 'missing gateway';
        if (!transaction.gateway_reference) {
          return `${transaction.gateway} missing reference`;
        }
        return transaction.gateway;
      })
    ),
  ];
}

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
  supabase: Pick<SupabaseClient, 'from'>;
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
