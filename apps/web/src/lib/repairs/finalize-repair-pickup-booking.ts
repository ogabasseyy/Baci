import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type BookRepairPickupResult,
  pickupFailure,
} from '@/lib/repairs/pickup-shipment-utils';
import type { ShipmentBookingResult } from '@/lib/shipping/types';

interface FinalizeRepairPickupBookingInput {
  booking: ShipmentBookingResult;
  lockToken: string;
  merchantId: string;
  quoteId: string;
  repairId: string;
  shipmentId: string;
  supabase: SupabaseClient;
}

export async function finalizeRepairPickupBooking({
  booking,
  lockToken,
  merchantId,
  quoteId,
  repairId,
  shipmentId,
  supabase,
}: FinalizeRepairPickupBookingInput): Promise<BookRepairPickupResult> {
  const { data: bookedShipmentData, error: bookedShipmentError } =
    await supabase
      .from('shipments')
      .update({
        provider: booking.provider,
        provider_shipment_id: booking.providerShipmentId,
        tracking_number: booking.trackingNumber,
        carrier_name: booking.carrierName,
        status: booking.status,
        is_station_pickup: booking.isStationPickup ?? false,
        station_name: booking.pickupStationName ?? null,
        station_address: booking.pickupStationAddress ?? null,
        pickup_scheduled_at: booking.pickupScheduledAt?.toISOString() ?? null,
        label_url: booking.labelUrl ?? null,
        provider_response: booking.rawResponse ?? null,
      })
      .eq('id', shipmentId)
      .eq('merchant_id', merchantId)
      .select('id')
      .single();

  if (bookedShipmentError || !bookedShipmentData) {
    console.error(
      'Repair pickup was booked but the pending shipment could not be finalized:',
      bookedShipmentError
    );
    return pickupFailure('shipment_save_failed');
  }

  const { error: clearLockError } = await supabase
    .from('repairs')
    .update({
      pickup_payment_status: 'booked',
      pickup_booking_lock_token: null,
      pickup_booking_started_at: null,
    })
    .eq('id', repairId)
    .eq('merchant_id', merchantId)
    .eq('shipment_id', shipmentId)
    .eq('pickup_booking_lock_token', lockToken);

  if (clearLockError) {
    console.error(
      'Failed to clear repair pickup booking lock:',
      clearLockError
    );
    // Shipment already holds GIGL tracking; fail closed so the webhook retries
    // and reconcileLinkedRepairPickup can finish clearing the lock.
    return pickupFailure('shipment_save_failed');
  }

  const { error: quoteUsedError } = await supabase
    .from('repair_pickup_quotes')
    .update({ used: true })
    .eq('id', quoteId)
    .eq('merchant_id', merchantId);

  if (quoteUsedError) {
    console.error('Failed to mark repair pickup quote used:', quoteUsedError);
    return pickupFailure('shipment_save_failed');
  }

  return {
    ok: true,
    trackingNumber: booking.trackingNumber,
    carrierName: booking.carrierName,
    shipmentId,
    pickupScheduledAt: booking.pickupScheduledAt?.toISOString() ?? null,
  };
}
