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
    const { data: refund } = await supabase
      .from('transactions')
      .select(
        'id, order_id, merchant_id, gateway_reference, amount, currency, metadata, status'
      )
      .eq('transaction_type', 'refund')
      .eq('gateway', 'paystack')
      .eq('gateway_reference', String(refundId))
      .maybeSingle();
    if (refund) {
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
