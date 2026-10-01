import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { CompletedPaymentMatch } from './fetch-completed-payments-by-reference';
import type { RefundRecoveryEvidence } from './file-paystack-refund-candidate-reviews';
import { filePaystackRefundRecoveryReview } from './file-paystack-refund-recovery-review';
import { fileProviderRefundOutsideCancellationReview } from './file-provider-refund-outside-cancellation-review';
import {
  lookupLocalRefundByProviderId,
  reconcileRecoveredRow,
} from './recover-unknown-paystack-refund-row';
import type { VerifiedUnknownRefundProvider } from './verify-unknown-paystack-refund-provider';

/**
 * Record the local audit row for a verified refund whose reference
 * resolves to a single completed payment on a cancelled order, then
 * reconcile it through the standard transition. Verified refunds on
 * active orders file for operations instead (polling can never
 * rediscover a provider-only refund after acknowledgement), and a
 * concurrent event (or the in-flight initiation) that records first
 * reconciles the winning row rather than failing.
 */
export async function recordRecoveredPaystackRefund(
  supabase: SupabaseClient,
  {
    current,
    evidence,
    payment,
    refundId,
  }: {
    current: VerifiedUnknownRefundProvider['current'];
    evidence: RefundRecoveryEvidence;
    payment: CompletedPaymentMatch & { order_id: string };
    refundId: number;
  }
): Promise<void> {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, order_number, cancelled_at, shipping_status')
    .eq('id', payment.order_id)
    .maybeSingle();
  if (orderError) throw new Error('refund_event_order_lookup_failed');
  if (!order) {
    logger.info({
      message: 'Unknown Paystack refund event payment has no order',
      refundId,
    });
    return;
  }
  if (
    order.cancelled_at == null ||
    (order.shipping_status !== 'cancelled' &&
      order.shipping_status !== 'canceled')
  ) {
    // Verified refund on an active order: file for operations (polling
    // can never rediscover it). Write failures throw for redelivery.
    await fileProviderRefundOutsideCancellationReview(supabase, {
      amount: current.amount / 100,
      currency: current.currency,
      merchantId: payment.merchant_id,
      orderId: payment.order_id,
      orderNumber: order.order_number,
      paymentId: payment.id,
      paymentReference: payment.gateway_reference,
      providerPaymentTransactionId: evidence.providerPaymentTransactionId,
      providerRefundId: refundId,
      providerRefundStatus: current.status,
    });
    logger.info({
      message: 'Unknown Paystack refund event filed for an active order',
      refundId,
    });
    return;
  }
  // A concurrent event (or the in-flight initiation) may record the row
  // first: on conflict, reconcile the winning row instead of failing.
  const refundRowId = crypto.randomUUID();
  const providerVerdict = current.status.toLowerCase();
  // A failed/needs-attention verdict must NOT be pre-populated: the
  // record RPC treats an equal metadata verdict as a repeat and returns
  // before transitioning the row or queuing the failure notification,
  // stranding the side effect deferred while every poll no-ops. Leave
  // it unset so the first reconcile applies the transition; later polls
  // repeat no-op correctly once the RPC has persisted it.
  const failedVerdict =
    providerVerdict === 'failed' || providerVerdict === 'needs-attention';
  const { error: insertError } = await supabase.from('transactions').insert({
    id: refundRowId,
    order_id: payment.order_id,
    merchant_id: payment.merchant_id,
    transaction_type: 'refund',
    amount: current.amount / 100,
    currency: current.currency,
    status: 'refund_pending',
    gateway: 'paystack',
    gateway_reference: String(refundId),
    description: `Refund for cancelled order #${order.order_number || order.id.slice(0, 8)}`,
    metadata: {
      payment_transaction_id: payment.id,
      provider_payment_transaction_id: evidence.providerPaymentTransactionId,
      ...(failedVerdict ? {} : { provider_refund_status: providerVerdict }),
      recovered_from_provider_event: true,
    },
  });
  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') {
      const raced = await lookupLocalRefundByProviderId(supabase, refundId);
      if (raced) {
        await reconcileRecoveredRow(supabase, raced);
        return;
      }
      // The order/reference slot is held by a row that is not this Paystack
      // refund, so redelivery would collide forever: persist the verified
      // provider evidence for reconciliation, then acknowledge.
      await filePaystackRefundRecoveryReview(supabase, {
        candidates: [
          {
            payment_transaction_id: payment.id,
            order_id: payment.order_id,
            amount: payment.amount,
            gateway_reference: payment.gateway_reference,
          },
        ],
        merchantId: payment.merchant_id,
        metadata: {
          provider_refund_id: refundId,
          provider_payment_transaction_id:
            evidence.providerPaymentTransactionId,
          payment_transaction_id: payment.id,
          audit_record_failed: true,
          recovered_from_provider_event: true,
        },
        orderId: payment.order_id,
        paystackRef: String(refundId),
        providerRefundStatus: current.status,
        reason: `Paystack refund ${refundId} collides with a non-refund transaction and cannot be recorded`,
      });
      logger.info({
        message: 'Unknown Paystack refund audit collides; review filed',
        refundId,
      });
      return;
    }
    throw new Error('refund_recovery_audit_failed');
  }
  await reconcileRecoveredRow(supabase, {
    id: refundRowId,
    order_id: payment.order_id,
    merchant_id: payment.merchant_id,
    gateway_reference: String(refundId),
    amount: current.amount / 100,
    currency: current.currency,
    metadata: {
      payment_transaction_id: payment.id,
      provider_payment_transaction_id: evidence.providerPaymentTransactionId,
      ...(failedVerdict ? {} : { provider_refund_status: providerVerdict }),
      recovered_from_provider_event: true,
    },
    status: 'refund_pending',
  });
}
