import type { SupabaseClient } from '@supabase/supabase-js';
import { claimRepairPickupBooking } from '@/lib/repairs/claim-repair-pickup-booking';
import { finalizeRepairPickupBooking } from '@/lib/repairs/finalize-repair-pickup-booking';
import {
  isRepairPickupPaymentReady,
  isRepairPickupQuoteAbovePaidFee,
} from '@/lib/repairs/is-repair-pickup-payment-ready';
import {
  type BookRepairPickupResult,
  buildPickupItems,
  buildPickupSender,
  pickupFailure,
} from '@/lib/repairs/pickup-shipment-utils';
import { quoteRepairPickup } from '@/lib/repairs/quote-repair-pickup';
import { reconcileLinkedRepairPickup } from '@/lib/repairs/reconcile-linked-repair-pickup';
import { releaseRejectedRepairPickupReservation } from '@/lib/repairs/release-rejected-repair-pickup-reservation';
import { releaseRepairPickupBookingClaim } from '@/lib/repairs/release-repair-pickup-booking-claim';
import { releaseUnlinkedRepairPickupReservation } from '@/lib/repairs/release-unlinked-repair-pickup-reservation';
import {
  getRepairCenterAddress,
  RepairCenterLookupError,
} from '@/lib/repairs/repair-center-address';
import { REPAIR_PICKUP_PROVIDER } from '@/lib/repairs/repair-pickup-constants';
import type { RepairPickupRow } from '@/lib/repairs/repair-pickup-row';
import {
  isRepairStatus,
  isTerminalRepairStatus,
} from '@/lib/repairs/repair-status';
import { shippingService } from '@/lib/shipping';
import { shouldReleaseBookingLock } from '@/lib/shipping/order-shipment-booking-lock-errors';
import type {
  BookingRequest,
  ShipmentBookingResult,
} from '@/lib/shipping/types';

export async function bookRepairPickup(
  supabase: SupabaseClient,
  merchantId: string,
  repairId: string
): Promise<BookRepairPickupResult> {
  const { data: repairData, error: repairError } = await supabase
    .from('repairs')
    .select(
      'id, merchant_id, customer_name, customer_email, customer_phone, device_type, device_model, pickup_address, pickup_fee, pickup_payment_status, pickup_payment_reference, shipment_id, quoted_price, status'
    )
    .eq('id', repairId)
    .eq('merchant_id', merchantId)
    .maybeSingle();

  const repair = repairData as RepairPickupRow | null;
  if (repairError) {
    console.error('Repair pickup lookup failed:', repairError);
    return pickupFailure('lookup_failed');
  }
  if (!repair) {
    return pickupFailure('not_found');
  }

  if (isRepairStatus(repair.status) && isTerminalRepairStatus(repair.status)) {
    return pickupFailure('terminal_status');
  }

  if (repair.shipment_id) {
    if (
      repair.pickup_payment_status === 'booked' ||
      (await reconcileLinkedRepairPickup(
        supabase,
        merchantId,
        repairId,
        repair.shipment_id
      ))
    ) {
      return pickupFailure('already_booked');
    }
    return pickupFailure('shipment_save_failed');
  }

  if (!isRepairPickupPaymentReady(repair)) {
    return pickupFailure('payment_required');
  }
  const sender = buildPickupSender(repair);
  if (!sender) {
    return pickupFailure('missing_pickup_address');
  }
  let receiver: Awaited<ReturnType<typeof getRepairCenterAddress>>;
  try {
    receiver = await getRepairCenterAddress(merchantId, 'server-fulfillment');
  } catch (error) {
    if (!(error instanceof RepairCenterLookupError)) {
      throw error;
    }
    console.error('Repair center lookup failed during pickup booking:', error);
    return pickupFailure('lookup_failed');
  }
  if (!receiver) {
    return pickupFailure('repair_center_unconfigured');
  }
  const items = buildPickupItems(repair);
  let quoteResult: Awaited<ReturnType<typeof quoteRepairPickup>>;
  try {
    quoteResult = await quoteRepairPickup({
      items,
      merchantId,
      receiver,
      sender,
    });
  } catch (error) {
    console.error('Repair pickup quote failed:', error);
    return pickupFailure('gigl_unavailable');
  }
  const { quote, request: quoteRequest } = quoteResult;
  if (!quote) {
    return pickupFailure('gigl_unavailable');
  }

  if (isRepairPickupQuoteAbovePaidFee(quote.price, repair.pickup_fee)) {
    return pickupFailure('quote_increased');
  }

  const { data: quoteRowData, error: quoteInsertError } = await supabase
    .from('repair_pickup_quotes')
    .insert({
      merchant_id: merchantId,
      repair_id: repairId,
      provider: REPAIR_PICKUP_PROVIDER,
      service_tier: quote.serviceTier,
      carrier_name: quote.carrierName,
      provider_rate_id: quote.providerRateId ?? null,
      charge: quote.price,
      currency: quote.currency,
      estimated_days: quote.estimatedDays,
      quote_request: quoteRequest,
      provider_metadata: quote.rawResponse ?? null,
      expires_at: quote.expiresAt.toISOString(),
    })
    .select('id')
    .single();

  const quoteRow = quoteRowData as { id: string } | null;
  if (quoteInsertError || !quoteRow) {
    console.error('Failed to persist repair pickup quote:', quoteInsertError);
    return pickupFailure('booking_failed');
  }

  const bookingRequest: BookingRequest = {
    orderId: repairId,
    quoteId: quoteRow.id,
    merchantId,
    providerRateId: quote.providerRateId || undefined,
    quoteMetadata: quote.rawResponse,
    sender,
    receiver: quoteRequest.receiver,
    items,
    pickupType: 'pickup',
  };

  const claim = await claimRepairPickupBooking(supabase, merchantId, repairId);
  if (claim.status === 'not_found') {
    return pickupFailure('not_found');
  }
  if (claim.status === 'terminal') {
    // Never book a paid pickup after a concurrent terminal transition.
    return pickupFailure('terminal_status');
  }
  if (claim.status === 'already_booked') {
    return pickupFailure('already_booked');
  }
  if (claim.status === 'booking_in_progress') {
    return pickupFailure('booking_in_progress');
  }
  if (claim.status === 'failed') {
    return pickupFailure('booking_failed');
  }

  // Reserve locally first so ambiguous provider failures cannot be retried.
  const { data: shipmentData, error: shipmentError } = await supabase
    .from('shipments')
    .insert({
      order_id: null,
      merchant_id: merchantId,
      provider: REPAIR_PICKUP_PROVIDER,
      provider_shipment_id: null,
      tracking_number: null,
      carrier_name: quote.carrierName,
      status: 'pending',
      sender_address: sender,
      receiver_address: quoteRequest.receiver,
      items,
      price: quote.price,
      currency: quote.currency,
      estimated_delivery_days: quote.estimatedDays,
      is_station_pickup: false,
      station_name: null,
      station_address: null,
      pickup_scheduled_at: null,
      label_url: null,
      provider_response: quote.rawResponse ?? null,
    })
    .select('id')
    .single();

  const shipment = shipmentData as { id: string } | null;
  if (shipmentError || !shipment) {
    console.error('Repair pickup shipment could not be saved:', shipmentError);
    await releaseRepairPickupBookingClaim(
      supabase,
      merchantId,
      repairId,
      claim.lockToken
    );
    return pickupFailure('booking_failed');
  }

  const { data: linkedRepairData, error: linkError } = await supabase
    .from('repairs')
    .update({
      shipment_id: shipment.id,
    })
    .eq('id', repairId)
    .eq('merchant_id', merchantId)
    .eq('pickup_booking_lock_token', claim.lockToken)
    .is('shipment_id', null)
    .not('status', 'in', '(completed,cancelled,rejected)')
    .select('id');

  if (linkError) {
    console.error('Repair pickup booked but link failed:', linkError);
    return pickupFailure(
      await releaseUnlinkedRepairPickupReservation(
        supabase,
        merchantId,
        repairId,
        shipment.id,
        claim.lockToken
      )
    );
  }

  const linkedRepair = Array.isArray(linkedRepairData)
    ? linkedRepairData[0]
    : null;
  if (!linkedRepair) {
    console.error(
      'Repair pickup reservation could not be linked to the claimed repair'
    );
    return pickupFailure(
      await releaseUnlinkedRepairPickupReservation(
        supabase,
        merchantId,
        repairId,
        shipment.id,
        claim.lockToken
      )
    );
  }

  let booking: ShipmentBookingResult;
  try {
    booking = await shippingService.bookShipment(
      REPAIR_PICKUP_PROVIDER,
      bookingRequest
    );
  } catch (error) {
    if (shouldReleaseBookingLock(error)) {
      const released = await releaseRejectedRepairPickupReservation(
        supabase,
        merchantId,
        repairId,
        shipment.id,
        claim.lockToken
      );
      if (released) {
        return pickupFailure(
          error.code === 'GIGL_BOOKING_VALIDATION_FAILED'
            ? 'provider_rejected'
            : 'booking_failed'
        );
      }
    }

    console.error('Repair pickup booking could not be confirmed:', error);
    return pickupFailure('shipment_save_failed');
  }

  return finalizeRepairPickupBooking({
    booking,
    lockToken: claim.lockToken,
    merchantId,
    quoteId: quoteRow.id,
    repairId,
    shipmentId: shipment.id,
    supabase,
  });
}
