import type { SupabaseClient } from '@supabase/supabase-js';
import { BOOKED_SHIPMENT_NOT_SAVED_CODE } from '@/lib/shipping/booking-failure-constants';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import { recordOrderShipmentBookingFailure } from '@/lib/shipping/record-order-shipment-booking-failure';

/**
 * The carrier booked the parcel but the order update that saves it failed (a
 * raced cancellation or a lost lock token). The lock stays when one was acquired, so record why.
 */
export async function recordBookedOrderUpdateFailure(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  lockHeld: boolean
): Promise<void> {
  await recordOrderShipmentBookingFailure(
    supabase,
    merchantId,
    orderId,
    new OrderShipmentBookingError(
      'The carrier booked this shipment but the order could not be updated to save it. Check the shipment before booking again.',
      500,
      BOOKED_SHIPMENT_NOT_SAVED_CODE
    ),
    lockHeld
  );
}
