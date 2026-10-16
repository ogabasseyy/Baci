// Raced-cancellation re-read for PATCH /api/orders/[id].
//
// A conditional update that matched zero rows (PGRST116) may mean a
// cancellation committed between the route's initial read and the
// write: re-read the statuses and let the same terminal-state policy
// answer, so the race surfaces as the terminal 409 instead of a
// generic 500. Extracted from the oversized route alongside
// evaluate-order-cancelled-transition.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type CancelledTransitionRejection,
  cancelledTerminalRejection,
  evaluateOrderCancelledTransition,
} from './evaluate-order-cancelled-transition';

export function createRacedCancellationRejection(input: {
  supabase: SupabaseClient;
  merchantId: string;
  orderId: string;
  requestedPaymentStatus: string | undefined;
  requestedShippingStatus: string | undefined;
}): () => Promise<CancelledTransitionRejection | null> {
  return async () => {
    const { data: freshOrder } = await input.supabase
      .from('orders')
      .select('payment_status, shipping_status')
      .eq('id', input.orderId)
      .eq('merchant_id', input.merchantId)
      .single();
    if (!freshOrder) return null;
    const fresh = freshOrder as {
      payment_status: string | null;
      shipping_status: string | null;
    };
    return (
      evaluateOrderCancelledTransition({
        existingPaymentStatus: fresh.payment_status,
        existingShippingStatus: fresh.shipping_status,
        requestedPaymentStatus: input.requestedPaymentStatus,
        requestedShippingStatus: input.requestedShippingStatus,
      }) ??
      cancelledTerminalRejection({
        existingPaymentStatus: fresh.payment_status,
        existingShippingStatus: fresh.shipping_status,
      })
    );
  };
}
