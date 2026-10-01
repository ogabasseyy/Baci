import type { SupabaseClient } from '@supabase/supabase-js';
import { initiateRefund as initiatePaystackRefund } from '@/lib/initiate-paystack-refund';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { handlePaystackCancellationRefundFailure } from '@/lib/orders/handle-paystack-cancellation-refund-failure';
import { recordPaystackCancellationRefund } from '@/lib/orders/record-paystack-cancellation-refund';

/**
 * Initiate a Paystack refund for every gateway leg that has no recorded
 * completed refund, auditing each accepted refund before moving on. Returns
 * the accepted provider refund IDs. Throws on the first leg that cannot
 * proceed; quarantine paths file a reconciliation review first.
 */
export async function initiatePaystackCancellationRefunds({
  deadlineMs,
  isLastAttempt,
  order,
  reason,
  refundedPaymentIds,
  supabase,
  transactions,
}: {
  deadlineMs?: number;
  /**
   * Set when this run consumes the final retry attempt: a
   * transiently-failing leg must file durable evidence instead of
   * throwing retryable, since the drain never reselects
   * attempts-capped rows.
   */
  isLastAttempt?: boolean;
  order: {
    currency: string | null;
    id: string;
    merchant_id: string;
    order_number: string | null;
  };
  reason?: string;
  refundedPaymentIds: Set<string>;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transactions: GatewayPaymentTransaction[];
}): Promise<number[]> {
  const refundIds: number[] = [];

  for (const transaction of transactions) {
    if (refundedPaymentIds.has(transaction.id)) continue;
    // Bound every leg to the remaining invocation deadline: a plain
    // Error keeps the step retryable, so unattempted legs run on the
    // next tick instead of stranding a mid-flight claim.
    const timeoutMs =
      deadlineMs === undefined ? undefined : deadlineMs - Date.now();
    if (timeoutMs !== undefined && timeoutMs <= 0) {
      throw new Error('cancellation_refund_deadline_exceeded');
    }
    const transactionAmount = Number(transaction.amount);
    const paystackRefund = await initiatePaystackRefund(
      transaction.gateway_reference as string,
      Math.round(transactionAmount * 100),
      reason || 'Order cancelled',
      timeoutMs
    );
    if (!paystackRefund.success) {
      await handlePaystackCancellationRefundFailure({
        isLastAttempt,
        order,
        paystackRefund,
        refundIds,
        supabase,
        transaction,
      });
      continue;
    }
    refundIds.push(
      await recordPaystackCancellationRefund({
        order,
        paystackRefund,
        reason,
        supabase,
        transaction,
        transactionAmount,
      })
    );
  }
  return refundIds;
}
