import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReusableOrderShipmentResult } from '@/lib/shipping/find-reusable-order-shipment';
import { findReusableOrderShipment } from '@/lib/shipping/find-reusable-order-shipment';
import { claimOrderShipmentBooking } from '@/lib/shipping/order-shipment-booking-lock';
import type { ShipmentBookingResult } from '@/lib/shipping/types';

export type DirectBookingAttempt =
  | { status: 'claimed'; lockToken: string | null }
  | { status: 'in_progress' | 'already_booked' }
  | {
      status: 'recovered';
      existingShipment: ReusableOrderShipmentResult;
      result: ShipmentBookingResult;
    };

/**
 * Claims the direct booking path and recovers a provider booking that was
 * persisted before a later order mutation failed. The provider must not be
 * called again when a complete local shipment already exists.
 */
export async function prepareDirectBookingAttempt(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string
): Promise<DirectBookingAttempt> {
  const claim = await claimOrderShipmentBooking(supabase, merchantId, orderId);
  if (claim.status !== 'claimed') {
    return claim;
  }

  const existingShipment = await findReusableOrderShipment(
    supabase,
    merchantId,
    orderId
  );
  if (!existingShipment) {
    return claim;
  }

  return {
    status: 'recovered',
    existingShipment,
    result: {
      provider: existingShipment.provider,
      providerShipmentId: existingShipment.providerShipmentId,
      trackingNumber: existingShipment.trackingNumber,
      carrierName: existingShipment.carrierName,
      labelUrl: existingShipment.labelUrl,
      pickupScheduledAt: existingShipment.pickupScheduledAt,
      status: existingShipment.shipmentStatus,
      rawResponse: { recovered: true },
    },
  };
}
