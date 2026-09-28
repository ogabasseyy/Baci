import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { fileRefundEvidenceReview } from '@/lib/payments/file-refund-evidence-review';
import { holdPaystackRefundForReview } from '@/lib/payments/hold-paystack-refund-for-review';
import { isDeterministicRefundError } from '@/lib/payments/is-deterministic-paystack-refund-error';
import type { RefundRow } from '@/lib/payments/paystack-cancellation-refund-row';
import { reconcilePaystackCancellationRefund } from '@/lib/payments/reconcile-paystack-cancellation-refund';
import { reconcilePaystackRefundEvent } from '@/lib/payments/reconcile-paystack-refund-event';
import { recoverUnknownPaystackRefund } from '@/lib/payments/recover-unknown-paystack-refund';
import { selectPaystackRefundReference } from '@/lib/select-paystack-refund-reference';

export async function handlePaystackCancellationRefundEvent(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
) {
  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : null;
  // Primary key: the refund's own provider ID always identifies the local
  // audit row, including unlinked legacy rows the payment-reference path
  // cannot reach and held rows polling skips.
  const refundId = data?.id;
  let unknownRefundId: number | undefined;
  // Nonpositive IDs can never match a provider refund: fall through to the
  // reference path instead of 503ing on a validation failure every delivery.
  if (
    typeof refundId === 'number' &&
    Number.isSafeInteger(refundId) &&
    refundId > 0
  ) {
    const { data: refund, error: lookupError } = await supabase
      .from('transactions')
      .select(
        'id, order_id, merchant_id, gateway_reference, amount, currency, metadata, status, cancel_order:orders!transactions_order_id_fkey(cancelled_at,shipping_status)'
      )
      .eq('transaction_type', 'refund')
      .eq('gateway', 'paystack')
      .eq('gateway_reference', String(refundId))
      .maybeSingle();
    if (lookupError) {
      logger.error({
        message: 'Paystack refund lookup failed',
        error: lookupError,
      });
      return NextResponse.json(
        { error: 'Refund reconciliation unavailable' },
        { status: 503 }
      );
    }
    if (refund) {
      // Mirror the record RPC's cancellation gate: a refund row from any
      // non-cancellation workflow would be rejected downstream, 503ing this
      // unrelated event into an endless redelivery loop. Acknowledge it
      // without invoking the cancellation reconciler.
      const cancelOrder = (
        refund as {
          cancel_order?: {
            cancelled_at?: string | null;
            shipping_status?: string | null;
          } | null;
        }
      ).cancel_order;
      if (
        cancelOrder?.cancelled_at == null ||
        (cancelOrder.shipping_status !== 'cancelled' &&
          cancelOrder.shipping_status !== 'canceled')
      ) {
        logger.info({
          message: 'Paystack refund event is not for a cancelled order',
          refundId,
        });
        return NextResponse.json({ message: 'Refund event acknowledged' });
      }
      try {
        await reconcilePaystackCancellationRefund(supabase, refund);
      } catch (reason) {
        // Deterministic mismatches (bad payment link, evidence mismatch)
        // never heal on redelivery — and failed rows are invisible to
        // polling — so file the durable review/hold used by the reference
        // path instead of 503ing forever.
        if (isDeterministicRefundError(reason)) {
          try {
            await fileRefundEvidenceReview(
              supabase,
              refund as RefundRow,
              reason.message
            );
            await holdPaystackRefundForReview(
              supabase,
              (refund as RefundRow).id,
              reason.message
            );
          } catch (persistenceError) {
            logger.error({
              message: 'Paystack refund review persistence failed',
              error: persistenceError,
            });
            return NextResponse.json(
              { error: 'Refund reconciliation unavailable' },
              { status: 503 }
            );
          }
          return NextResponse.json({ message: 'Refund event reconciled' });
        }
        logger.error({
          message: 'Paystack refund reconciliation failed',
          error: reason,
        });
        return NextResponse.json(
          { error: 'Refund reconciliation unavailable' },
          { status: 503 }
        );
      }
      return NextResponse.json({ message: 'Refund event reconciled' });
    }
    // The event references a provider refund with no local audit row: a
    // merchant-created replacement, or an event that beat the audit
    // insert. Recover it via provider reads below instead of dropping
    // the ID and rechecking only stale local rows.
    unknownRefundId = refundId;
  }
  // Fallback: the original payment reference, nested per the refund
  // resource shape with the flat field retained for compatibility. The
  // nested value wins only when the reconciler can consume it; an
  // unusable nested string must not shadow a usable flat one.
  const transaction = data?.transaction;
  const nestedReference =
    transaction && typeof transaction === 'object'
      ? (transaction as Record<string, unknown>).reference
      : undefined;
  const flatReference = data?.transaction_reference;
  const paymentReference = selectPaystackRefundReference(
    nestedReference,
    flatReference
  );
  if (unknownRefundId !== undefined) {
    try {
      await recoverUnknownPaystackRefund(
        supabase,
        unknownRefundId,
        paymentReference
      );
    } catch (error) {
      logger.error({
        message: 'Paystack refund recovery failed',
        error,
      });
      return NextResponse.json(
        { error: 'Refund reconciliation unavailable' },
        { status: 503 }
      );
    }
    return NextResponse.json({ message: 'Refund event reconciled' });
  }
  if (paymentReference !== undefined) {
    try {
      await reconcilePaystackRefundEvent(supabase, paymentReference);
    } catch (error) {
      logger.error({
        message: 'Paystack refund reconciliation failed',
        error,
      });
      return NextResponse.json(
        { error: 'Refund reconciliation unavailable' },
        { status: 503 }
      );
    }
  }
  return NextResponse.json({ message: 'Refund event reconciled' });
}
