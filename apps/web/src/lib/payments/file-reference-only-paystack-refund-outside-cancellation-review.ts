import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * File non-cancellation evidence for a signed reference-only refund
 * event on an ACTIVE order. The event carries no refund ID, so the
 * cancellation recovery path cannot record it — but the customer may
 * have been refunded while the order stays paid, settleable, and
 * fulfillable, and polling can never rediscover a provider-only
 * refund. The review stays open for operations. One open review per
 * order: redeliveries merge payment-keyed evidence into it. The key
 * carries the verdict, so a later genuine refund cannot overwrite an
 * earlier failed one for the same payment. Throws on write failure
 * for redelivery.
 */

/**
 * Slug a provider verdict for use in an evidence key. The verdict is
 * free-form provider text, so it is lowercased, stripped to a safe
 * alphabet, and bounded — the raw value still rides nested inside
 * the evidence object, so nothing is lost.
 */
function verdictSuffix(status: string): string {
  const slug = status
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug === '' ? 'unknown' : slug;
}
export async function fileReferenceOnlyPaystackRefundOutsideCancellationReview(
  supabase: SupabaseClient,
  {
    amount,
    currency,
    merchantId,
    orderId,
    orderNumber,
    paymentId,
    paymentReference,
    providerRefundStatus,
  }: {
    amount: number;
    currency: string;
    merchantId: string;
    orderId: string;
    orderNumber: string | null;
    paymentId: string;
    paymentReference: string;
    providerRefundStatus: string;
  }
): Promise<void> {
  // No settled-coverage suppression: the event carries no refund ID,
  // so it can never be tied to a recorded row — treating it as a
  // duplicate of covering rows would hide a second manual refund and
  // its over-refund. Redeliveries merge idempotently under the same
  // evidence key instead.
  const orderLabel = orderNumber || orderId.slice(0, 8).toUpperCase();
  const reason =
    `Paystack refund event for payment ${paymentReference} on active ` +
    `order #${orderLabel} has no local audit row; verify the provider ` +
    `refund before fulfillment or settlement`;
  const candidates = [
    {
      amount,
      currency,
      gateway: 'paystack',
      gatewayReference: paymentReference,
      order_id: orderId,
      payment_transaction_id: paymentId,
    },
  ];
  // Verdict-suffixed: without it, the first failed refund's evidence
  // would stick while a later genuine refund for the same payment —
  // or vice versa — overwrote it under the identical key, and audit
  // blocking reads the nested verdict per leg.
  const evidenceKey = `payment:${paymentId}:${verdictSuffix(providerRefundStatus)}`;
  // The verdict rides in the same object the merge path stores
  // verbatim, so insert and merge produce the identical nested entry:
  // a definitively failed provider refund moved no money, and audit
  // blocking excludes failed-only evidence per leg instead of
  // stranding a later genuine cancellation behind delivery_uncertain.
  const evidence = {
    audit_record_failed: true,
    payment_transaction_id: paymentId,
    payment_reference: paymentReference,
    payment_amount: amount,
    payment_currency: currency,
    provider_refund_status: providerRefundStatus,
    reference_only_refund_event: true,
    reason: reason.slice(0, 120),
    observed_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('reconciliation_review').insert({
    candidates,
    issue_type: 'provider_refund_outside_cancellation',
    merchant_id: merchantId,
    metadata: {
      audit_record_failed: true,
      payment_transaction_id: paymentId,
      reference: paymentReference,
      reference_only_refund_event: true,
      refund_evidence: {
        [evidenceKey]: evidence,
      },
    },
    order_id: orderId,
    // Deliberately unset: a shared or corrupt reference spans orders,
    // and the open-by-paystack-ref index would collapse all but the
    // first order's review.
    paystack_ref: null,
    reason,
    txn_id: null,
  });
  if (!error) {
    logger.warn({
      message:
        'Paystack reference-only refund event on an active order has no local audit row',
      orderId,
      paymentId,
      paymentReference,
    });
    return;
  }
  if ((error as { code?: string }).code !== '23505') {
    throw new Error('reference_only_refund_review_persistence_failed');
  }
  const { data: merged, error: mergeError } = await supabase.rpc(
    'merge_provider_refund_outside_cancellation_evidence_v1',
    {
      p_order_id: orderId,
      p_merchant_id: merchantId,
      p_evidence_key: evidenceKey,
      p_evidence: evidence,
      p_candidates: candidates,
    }
  );
  if (mergeError || merged !== true) {
    throw new Error('reference_only_refund_review_persistence_failed');
  }
}
