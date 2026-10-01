import type { SupabaseClient } from '@supabase/supabase-js';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import type {
  ShipmentBookingResult,
  ShippingProviderCode,
} from '@/lib/shipping/types';

export type ReusableOrderShipmentResult = {
  shipmentId: string;
  provider: ShippingProviderCode;
  providerShipmentId: string;
  trackingNumber: string;
  carrierName: string;
  quoteId: string;
  estimatedDays: number | null;
  labelUrl?: string;
  pickupScheduledAt?: Date;
  shipmentStatus: ShipmentBookingResult['status'];
};

type ExistingShipmentRecord = {
  id: string;
  provider: ShippingProviderCode;
  provider_shipment_id: string | null;
  shipping_quote_id: string | null;
  tracking_number: string | null;
  carrier_name: string | null;
  estimated_delivery_days: number | null;
  label_url: string | null;
  pickup_scheduled_at: string | null;
  status: ShipmentBookingResult['status'];
};

const REUSABLE_SHIPMENT_STATUSES: ShipmentBookingResult['status'][] = [
  'pending',
  'booked',
  'pickup_scheduled',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
];

export async function findReusableOrderShipment(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string
): Promise<ReusableOrderShipmentResult | null> {
  const { data: existingShipment, error: existingShipmentError } =
    await supabase
      .from('shipments')
      .select(
        'id, provider, provider_shipment_id, shipping_quote_id, tracking_number, carrier_name, estimated_delivery_days, label_url, pickup_scheduled_at, status'
      )
      .eq('order_id', orderId)
      .eq('merchant_id', merchantId)
      .in('status', REUSABLE_SHIPMENT_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
  const typedExistingShipment =
    existingShipment as ExistingShipmentRecord | null;

  if (existingShipmentError) {
    throw new OrderShipmentBookingError(
      'Failed to load the existing shipment for this order.',
      500,
      'EXISTING_SHIPMENT_LOOKUP_FAILED'
    );
  }

  if (!typedExistingShipment) {
    return null;
  }

  if (
    !typedExistingShipment.provider_shipment_id ||
    !typedExistingShipment.tracking_number ||
    !typedExistingShipment.carrier_name
  ) {
    throw new OrderShipmentBookingError(
      'A shipment is already saved for this order but is missing booking details. Please review it before retrying.',
      500,
      'INCOMPLETE_EXISTING_SHIPMENT'
    );
  }

  return {
    shipmentId: typedExistingShipment.id,
    provider: typedExistingShipment.provider,
    providerShipmentId: typedExistingShipment.provider_shipment_id,
    trackingNumber: typedExistingShipment.tracking_number,
    carrierName: typedExistingShipment.carrier_name,
    quoteId: typedExistingShipment.shipping_quote_id || '',
    estimatedDays: typedExistingShipment.estimated_delivery_days,
    labelUrl: typedExistingShipment.label_url || undefined,
    pickupScheduledAt: typedExistingShipment.pickup_scheduled_at
      ? new Date(typedExistingShipment.pickup_scheduled_at)
      : undefined,
    shipmentStatus: typedExistingShipment.status,
  };
}
