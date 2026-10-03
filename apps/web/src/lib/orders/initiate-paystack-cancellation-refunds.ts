import type { SupabaseClient } from '@supabase/supabase-js';
import { initiateRefund as initiatePaystackRefund } from '@/lib/initiate-paystack-refund';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { handlePaystackCancellationRefundFailure } from '@/lib/orders/handle-paystack-cancellation-refund-failure';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import { recordPaystackCancellationRefund } from '@/lib/orders/record-paystack-cancellation-refund';
import { tryResetCancellationSideEffectAttempts } from '@/lib/orders/reset-cancellation-side-effect-attempts';
import { DeferredError } from './run-order-cancellation-side-effect';

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
      // On the final attempt the claim has already raised the row to
      // the attempts cap, so a plain retryable error would finish it
      // as failed-with-five-attempts — a state the drain never
      // reselects — stranding this never-attempted leg with no
      // review. Defer with a fresh budget when the reset lands so
      // the resume attempts the leg; when the reset fails the budget
      // is spent, so quarantine the leg with durable evidence
      // instead of returning a retryable failure that cannot retry.
      if (isLastAttempt === true) {
        const resetFailed = await tryResetCancellationSideEffectAttempts(
          supabase,
          order.id,
          'refund'
        );
        if (!resetFailed) {
          throw new DeferredError(
            'cancellation_refund_deadline_deferred_for_budget'
          );
        }
        await quarantineRefund({
          metadata: {
            ...(refundIds.length > 0 ? { accepted_refund_ids: refundIds } : {}),
            failed_payment_transaction_id: transaction.id,
            // Definite non-acceptance: the deadline expired before
            // the provider was called, so no refund may exist and
            // the completion gate auto-closes on replacement
            // coverage.
            ambiguous_initiation: false,
            deadline_exhausted: true,
          },
          order,
          reason:
            'The cancellation refund deadline expired on the final attempt before this payment leg could be attempted',
          supabase,
          transactions: [transaction],
        });
      }
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
