import type { SupabaseClient } from '@supabase/supabase-js';
import { selectPaystackRefundReference } from '@/lib/select-paystack-refund-reference';
import { fileReferenceOnlyPaystackRefundOutsideCancellationReview } from './file-reference-only-paystack-refund-outside-cancellation-review';
import { fileReferenceOnlyPaystackRefundReview } from './file-reference-only-paystack-refund-review';
import { fileRefundEvidenceReview } from './file-refund-evidence-review';
import { holdPaystackRefundForReview } from './hold-paystack-refund-for-review';
import { isDeterministicRefundError } from './is-deterministic-paystack-refund-error';
import { openPaystackRefundReferenceWatch } from './open-paystack-refund-reference-watch';
import type { RefundRow } from './paystack-cancellation-refund-row';
import { reconcilePaystackCancellationRefund } from './reconcile-paystack-cancellation-refund';
import { resolvePaystackRefundReferenceWatch } from './resolve-paystack-refund-reference-watch';

const SHARED_REFERENCE_PAGE_SIZE = 10;
const REFUND_PAGE_SIZE = 10;

async function reconcileSharedReferencePayment(
  supabase: SupabaseClient,
  transactionReference: string,
  payment: Record<string, unknown>,
  providerRefundStatus: string
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
      providerRefundStatus,
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
        providerRefundStatus,
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

async function forEachReferencePayment(
  supabase: SupabaseClient,
  transactionReference: string,
  providerRefundStatus: string,
  stalled: boolean
): Promise<Set<string>> {
  // Keyset over the immutable id order: offsets over this
  // status-filtered set would shift when a payment completes (or a
  // stalled row transitions out) between page reads, skipping a later
  // match the caller then acknowledges without reconciling.
  let lastId: string | null = null;
  const handledIds = new Set<string>();
  for (;;) {
    const filtered = supabase
      .from('transactions')
      .select(
        'id, order_id, merchant_id, amount, currency, cancel_order:orders!transactions_order_id_fkey(cancelled_at,shipping_status,order_number)'
      )
      .eq('gateway', 'paystack')
      .eq('gateway_reference', transactionReference)
      .eq('transaction_type', 'payment');
    const statusFiltered = stalled
      ? filtered.in('status', ['pending', 'processing', 'failed'])
      : filtered.eq('status', 'completed');
    const ordered = statusFiltered.order('id', { ascending: true });
    const { data: payments, error: paymentError } = await (lastId === null
      ? ordered
      : ordered.gt('id', lastId)
    ).limit(SHARED_REFERENCE_PAGE_SIZE);
    if (paymentError) throw new Error('refund_event_payment_lookup_failed');
    const page = (payments ?? []) as Record<string, unknown>[];
    for (const payment of page) {
      if (typeof payment.id === 'string') handledIds.add(payment.id);
      await reconcileSharedReferencePayment(
        supabase,
        transactionReference,
        payment,
        providerRefundStatus
      );
    }
    if (page.length < SHARED_REFERENCE_PAGE_SIZE) break;
    lastId = (page[page.length - 1]?.id as string | undefined) ?? null;
    if (lastId === null) break;
  }
  return handledIds;
}

export async function reconcilePaystackRefundEvent(
  supabase: SupabaseClient,
  transactionReference: string,
  providerRefundStatus = 'unknown'
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
  const completedIds = await forEachReferencePayment(
    supabase,
    transactionReference,
    providerRefundStatus,
    false
  );
  // Always scan the stalled states too: a completed match does not
  // prove there are no additional in-flight matches, and the refund
  // webhook may have won the race with charge completion. A pending
  // or processing payment that later completes would leave the
  // refunded order paid and fulfillable with no trace of this signed
  // event, so persist its evidence against the stalled matches
  // instead of acknowledging after the completed pass alone. (Failed
  // rows ride along: a provider refund proves capture, so a failed
  // local row is a stale wedge the evidence usefully surfaces.)
  const stalledIds = await forEachReferencePayment(
    supabase,
    transactionReference,
    providerRefundStatus,
    true
  );
  // Always open the reference watch and re-scan atomically under the
  // lock the completion path claims under — even when the passes
  // handled other matches. A payment pending during the completed
  // scan may have completed before the stalled scan ran, so the
  // status filters omit it from both passes; without the locked
  // rescan its completion has no watch to claim and the event is
  // acknowledged with no evidence for that order. Rows the passes
  // already handled are skipped so the rescan never reconciles
  // twice; an empty fresh set leaves the watch open so a later
  // completion files the evidence instead of acknowledging silently.
  const handledIds = new Set([...completedIds, ...stalledIds]);
  const late = await openPaystackRefundReferenceWatch(supabase, {
    providerRefundStatus,
    reference: transactionReference,
  });
  const fresh = late.filter((payment) => !handledIds.has(payment.id));
  if (fresh.length === 0) return;
  for (const payment of fresh) {
    await reconcileSharedReferencePayment(
      supabase,
      transactionReference,
      payment as unknown as Record<string, unknown>,
      providerRefundStatus
    );
  }
  await resolvePaystackRefundReferenceWatch(supabase, {
    reference: transactionReference,
  });
}
