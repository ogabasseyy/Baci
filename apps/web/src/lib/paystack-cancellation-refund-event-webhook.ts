import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { reconcilePaystackCancellationRefund } from '@/lib/payments/reconcile-paystack-cancellation-refund';
import { reconcilePaystackRefundEvent } from '@/lib/payments/reconcile-paystack-refund-event';

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
  if (typeof refundId === 'number' && Number.isSafeInteger(refundId)) {
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
      return NextResponse.json({ message: 'Refund event reconciled' });
    }
  }
  // Fallback: the original payment reference, nested per the refund
  // resource shape with the flat field retained for compatibility.
  const transaction = data?.transaction;
  const nestedReference =
    transaction && typeof transaction === 'object'
      ? (transaction as Record<string, unknown>).reference
      : undefined;
  const flatReference = data?.transaction_reference;
  const paymentReference =
    typeof nestedReference === 'string'
      ? nestedReference
      : typeof flatReference === 'string'
        ? flatReference
        : undefined;
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
