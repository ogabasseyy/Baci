import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookOrderShipmentResult } from './book-order-shipment';
import type { MerchantShippingCharge } from './merchant-shipping-charge';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import type { ShippingProviderCode } from './types';

type BookedChargeShipmentRow = {
  shipment_id: string | null;
};

type BookedShipmentRow = {
  id: string;
  provider: ShippingProviderCode;
  provider_shipment_id: string | null;
  shipping_quote_id: string | null;
  tracking_number: string | null;
  carrier_name: string | null;
  estimated_delivery_days: number | null;
  label_url: string | null;
  pickup_scheduled_at: string | null;
  status: BookOrderShipmentResult['shipmentStatus'];
};

export async function recoverBookedWalletShipment(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  charge: MerchantShippingCharge
): Promise<BookOrderShipmentResult> {
  const { data: chargeRow, error: chargeError } = await supabase
    .from('merchant_shipping_charges')
    .select('shipment_id')
    .eq('id', charge.chargeId)
    .eq('merchant_id', merchantId)
    .eq('order_id', orderId)
    .maybeSingle();
  if (chargeError) {
    throw new OrderShipmentBookingError(
      'Failed to load the booked wallet shipment for this order.',
      500,
      'EXISTING_SHIPMENT_LOOKUP_FAILED'
    );
  }

  const shipmentId = (chargeRow as BookedChargeShipmentRow | null)?.shipment_id;
  if (!shipmentId) {
    throw new OrderShipmentBookingError(
      'This wallet charge is booked but has no saved shipment. Please review it before retrying.',
      409,
      'MERCHANT_WALLET_BOOKED_SHIPMENT_MISSING'
    );
  }

  const { data: shipment, error: shipmentError } = await supabase
    .from('shipments')
    .select(
      'id, provider, provider_shipment_id, shipping_quote_id, tracking_number, carrier_name, estimated_delivery_days, label_url, pickup_scheduled_at, status'
    )
    .eq('id', shipmentId)
    .eq('order_id', orderId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  const typedShipment = shipment as BookedShipmentRow | null;
  if (shipmentError) {
    throw new OrderShipmentBookingError(
      'Failed to load the booked wallet shipment for this order.',
      500,
      'EXISTING_SHIPMENT_LOOKUP_FAILED'
    );
  }
  if (
    !typedShipment?.provider_shipment_id ||
    !typedShipment.tracking_number ||
    !typedShipment.carrier_name
  ) {
    throw new OrderShipmentBookingError(
      'This wallet charge is booked but the saved shipment is incomplete. Please review it before retrying.',
      409,
      'MERCHANT_WALLET_BOOKED_SHIPMENT_MISSING'
    );
  }

  return {
    shipmentId: typedShipment.id,
    provider: typedShipment.provider,
    providerShipmentId: typedShipment.provider_shipment_id,
    trackingNumber: typedShipment.tracking_number,
    carrierName: typedShipment.carrier_name,
    quoteId: typedShipment.shipping_quote_id || '',
    estimatedDays: typedShipment.estimated_delivery_days,
    labelUrl: typedShipment.label_url || undefined,
    pickupScheduledAt: typedShipment.pickup_scheduled_at
      ? new Date(typedShipment.pickup_scheduled_at)
      : undefined,
    shipmentStatus: typedShipment.status,
  };
}
