import type { SupabaseClient } from '@supabase/supabase-js';
import { selectPaystackRefundReference } from '@/lib/select-paystack-refund-reference';
import { fileReferenceOnlyPaystackRefundOutsideCancellationReview } from './file-reference-only-paystack-refund-outside-cancellation-review';
import { fileReferenceOnlyPaystackRefundReview } from './file-reference-only-paystack-refund-review';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { holdPaystackRefundForReview } from './hold-paystack-refund-for-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import type { RefundRow } from './paystack-cancellation-refund-row';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';

const SHARED_REFERENCE_PAGE_SIZE = 10;
const REFUND_PAGE_SIZE = 10;

async function reconcileSharedReferencePayment(
  supabase: SupabaseClient,
  transactionReference: string,
  payment: Record<string, unknown>
): Promise<void> {
  if (!payment.order_id) return;
  // Mirror the ID handler's cancellation gate: a reference-only event
  // for a non-cancelled order must not reach the cancellation-only
  // reconciler, which would reject it and file an unrelated review.
  // But it must not be acknowledged silently either: the customer may
  // have been refunded while the order stays paid, settleable, and
  // fulfillable, and polling can never rediscover a provider-only
  // refund — so it files into the non-cancellation queue.
  const cancelOrder = (
    payment as {
      cancel_order?: {
        cancelled_at?: string | null;
        order_number?: string | null;
        shipping_status?: string | null;
      } | null;
    }
  ).cancel_order;
  const paymentRow = payment as {
    amount: number | string | null;
    currency: string | null;
    id: string;
    merchant_id: string;
    order_id: string;
  };
  if (
    cancelOrder?.cancelled_at == null ||
    (cancelOrder.shipping_status !== 'cancelled' &&
      cancelOrder.shipping_status !== 'canceled')
  ) {
    await fileReferenceOnlyPaystackRefundOutsideCancellationReview(supabase, {
      amount: Number(paymentRow.amount) || 0,
      currency: paymentRow.currency ?? 'NGN',
      merchantId: paymentRow.merchant_id,
      orderId: paymentRow.order_id,
      orderNumber: cancelOrder?.order_number ?? null,
      paymentId: paymentRow.id,
      // The query selected this payment by reference, so it identifies
      // the leg even when the stored row omits it.
      paymentReference: transactionReference,
    });
    return;
  }
  // Reconciling a row moves it out of the in-flight statuses, so offset
  // pagination would skip rows behind the mutation: page by id cursor
  // instead, so every in-flight refund for a shared reference is
  // revisited before this event is acknowledged.
  let cursor: string | null = null;
  let seenAnyRefund = false;
  for (;;) {
    const query = supabase
      .from('transactions')
      .select(
        'id, order_id, merchant_id, gateway_reference, amount, currency, metadata, status'
      )
      .eq('order_id', payment.order_id)
      .eq('merchant_id', payment.merchant_id)
      .eq('transaction_type', 'refund')
      .eq('gateway', 'paystack')
      .eq('metadata->>payment_transaction_id', payment.id)
      // A new signed provider event may resolve a held refund. Only polling
      // excludes review holds; the provider read still verifies all evidence.
      .in('status', ['refund_pending', 'pending', 'failed'])
      .order('id', { ascending: true })
      .limit(REFUND_PAGE_SIZE);
    const { data: refunds, error } =
      cursor === null ? await query : await query.gt('id', cursor);
    if (error) throw new Error('refund_event_lookup_failed');
    const page = (refunds ?? []) as RefundRow[];
    if (!seenAnyRefund && page.length === 0) {
      // No in-flight local row: either a late duplicate of an
      // already-reconciled refund (stays silent) or a provider refund
      // with no local audit row at all, which polling can never
      // rediscover — that fails closed with a durable review.
      await fileReferenceOnlyPaystackRefundReview(supabase, {
        amount: Number(paymentRow.amount) || 0,
        currency: paymentRow.currency ?? 'NGN',
        merchantId: paymentRow.merchant_id,
        orderId: paymentRow.order_id,
        paymentId: paymentRow.id,
        // The query selected this payment by reference, so it identifies
        // the leg even when the stored row omits it.
        paymentReference: transactionReference,
      });
      return;
    }
    seenAnyRefund = seenAnyRefund || page.length > 0;
    for (const refund of page) {
      try {
        await reconcilePaystackCancellationRefund(supabase, refund);
      } catch (reason) {
        if (!isDeterministicRefundError(reason)) throw reason;
        await fileRefundEvidenceReview(supabase, refund, reason.message);
        await holdPaystackRefundForReview(supabase, refund.id, reason.message);
      }
      cursor = refund.id;
    }
    if (page.length < REFUND_PAGE_SIZE) break;
  }
}

export async function reconcilePaystackRefundEvent(
  supabase: SupabaseClient,
  transactionReference: string
): Promise<void> {
  // Share the webhook reference alphabet: the caller already selected
  // this reference with the same validator, so only unusable values return.
  if (
    selectPaystackRefundReference(transactionReference, undefined) !==
    transactionReference
  )
    return;
  // A malformed or legacy reference can be shared by any number of
  // completed payments: paginate the whole match set before the caller
  // acknowledges the event, so no cancelled order misses
  // reconciliation or its missing-audit review.
  for (let offset = 0; ; offset += SHARED_REFERENCE_PAGE_SIZE) {
    const { data: payments, error: paymentError } = await supabase
      .from('transactions')
      .select(
        'id, order_id, merchant_id, amount, currency, cancel_order:orders!transactions_order_id_fkey(cancelled_at,shipping_status,order_number)'
      )
      .eq('gateway', 'paystack')
      .eq('gateway_reference', transactionReference)
      .eq('transaction_type', 'payment')
      .eq('status', 'completed')
      .order('id', { ascending: true })
      .range(offset, offset + SHARED_REFERENCE_PAGE_SIZE - 1);
    if (paymentError) throw new Error('refund_event_payment_lookup_failed');
    const page = (payments ?? []) as Record<string, unknown>[];
    for (const payment of page) {
      await reconcileSharedReferencePayment(
        supabase,
        transactionReference,
        payment
      );
    }
    if (page.length < SHARED_REFERENCE_PAGE_SIZE) break;
  }
}
