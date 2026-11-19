import type { SupabaseClient } from '@supabase/supabase-js';
import { OrderShipmentBookingError } from './order-shipment-booking-error';
import { BOOKED_SHIPMENT_NOT_SAVED_CODE } from './order-shipment-booking-failure';

/**
 * Post-submit guard: re-verifies the order payment state inside the shared
 * order-payment serialization boundary immediately before the local
 * persist. A pre-submit check alone cannot cover a refund that finalizes
 * while the provider call is in flight, so when the order is refunded at
 * this point the persist is refused: the provider booking stands and the
 * database has already filed the interception review carrying the
 * provider booking identity.
 */
export async function confirmBookedOrderPaymentPersist({
  merchantId,
  orderId,
  provider,
  providerShipmentId,
  supabase,
  trackingNumber,
}: {
  merchantId: string;
  orderId: string;
  provider: string;
  providerShipmentId: string | null;
  supabase: SupabaseClient;
  trackingNumber: string | null;
}): Promise<void> {
  const { data, error } = await supabase.rpc(
    'confirm_shippable_order_payment_for_booking_persist',
    {
      p_order_id: orderId,
      p_merchant_id: merchantId,
      p_provider: provider,
      p_provider_shipment_id: providerShipmentId,
      p_tracking_number: trackingNumber,
    }
  );
  if (!error) {
    // The refunded outcome is a returned receipt, not a raise: the
    // database files the interception review in the same call, and a
    // raise would roll that filing back when caught here.
    const receipt = Array.isArray(data) ? data[0] : data;
    if (
      receipt &&
      typeof receipt === 'object' &&
      (receipt as { persist_allowed?: unknown }).persist_allowed === false
    ) {
      throw new OrderShipmentBookingError(
        'This order was refunded after the provider booking was submitted. The shipment was recorded for operations review and was not saved.',
        409,
        'ORDER_REFUNDED_AFTER_BOOKING',
        providerShipmentId || trackingNumber || undefined
      );
    }
    return;
  }
  if (error.message?.includes('order_not_found_for_shipment')) {
    // Post-submit: the carrier already booked the parcel for an order that
    // can no longer be found, so this needs reconciliation, not a plain 404.
    throw new OrderShipmentBookingError(
      'The carrier booked this shipment but the order could not be found to save it. Check the shipment before booking again.',
      404,
      BOOKED_SHIPMENT_NOT_SAVED_CODE,
      providerShipmentId || trackingNumber || undefined
    );
  }
  // Post-submit: the carrier already booked the parcel, so say so (and keep
  // the lock) instead of reporting a pre-submit state-check failure.
  throw new OrderShipmentBookingError(
    'The carrier booked this shipment but we could not verify the order to save it. Check the shipment before booking again.',
    500,
    BOOKED_SHIPMENT_NOT_SAVED_CODE,
    providerShipmentId || trackingNumber || undefined
  );
}
