import type { SupabaseClient } from '@supabase/supabase-js';
import { OrderShipmentBookingError } from './order-shipment-booking-error';

/**
 * Re-reads the order payment state inside the shared order-payment
 * serialization boundary (the same advisory lock + row lock order refund
 * finalization uses) immediately before a provider submission. The booking
 * flow reads the order long before the provider call, so without this
 * fresh check a full refund that finalizes in between would still ship.
 */
export async function assertCurrentOrderPaymentShippable(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string
): Promise<void> {
  const { error } = await supabase.rpc('assert_shippable_order_payment', {
    p_order_id: orderId,
    p_merchant_id: merchantId,
  });
  if (!error) return;
  if (error.message?.includes('order_refunded_for_shipment')) {
    throw new OrderShipmentBookingError(
      'This order was refunded and can no longer be shipped.',
      400,
      'ORDER_REFUNDED'
    );
  }
  if (error.message?.includes('order_cancelled_for_shipment')) {
    throw new OrderShipmentBookingError(
      'This order was cancelled and can no longer be shipped.',
      400,
      'ORDER_CANCELLED'
    );
  }
  if (error.message?.includes('order_not_found_for_shipment')) {
    throw new OrderShipmentBookingError(
      'Order not found',
      404,
      'ORDER_NOT_FOUND'
    );
  }
  throw new OrderShipmentBookingError(
    'Could not verify this order is still payable for shipment.',
    500,
    'SHIPMENT_BOOKING_STATE_CHECK_FAILED'
  );
}
