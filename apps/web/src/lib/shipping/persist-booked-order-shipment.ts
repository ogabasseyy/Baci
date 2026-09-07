import type { SupabaseClient } from '@supabase/supabase-js';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import type { OrderShipmentQuoteRecord } from '@/lib/shipping/refresh-order-shipment-quote';
import type {
  ShipmentBookingResult,
  ShipmentItem,
  ShippingAddress,
} from '@/lib/shipping/types';

type PersistBookedOrderShipmentInput = {
  merchantId: string;
  orderId: string;
  quote: OrderShipmentQuoteRecord;
  result: ShipmentBookingResult;
  sender: ShippingAddress;
  receiver: ShippingAddress;
  items: ShipmentItem[];
};

export async function persistBookedOrderShipment(
  supabase: SupabaseClient,
  input: PersistBookedOrderShipmentInput
): Promise<{ shipmentId: string }> {
  const { data: shipment, error: shipmentError } = await supabase
    .from('shipments')
    .insert({
      order_id: input.orderId,
      merchant_id: input.merchantId,
      provider: input.result.provider,
      provider_shipment_id: input.result.providerShipmentId,
      shipping_quote_id: input.quote.id,
      tracking_number: input.result.trackingNumber,
      carrier_name: input.result.carrierName,
      status: input.result.status,
      sender_address: input.sender,
      receiver_address: input.receiver,
      items: input.items,
      price: Number(input.quote.price),
      currency: input.quote.currency,
      estimated_delivery_days: input.quote.estimated_days,
      is_station_pickup: input.result.isStationPickup ?? false,
      station_name: input.result.pickupStationName ?? null,
      station_address: input.result.pickupStationAddress ?? null,
      pickup_scheduled_at: input.result.pickupScheduledAt?.toISOString(),
      label_url: input.result.labelUrl,
      provider_response: input.result.rawResponse,
    })
    .select('id')
    .single();
  const typedShipment = shipment as { id: string } | null;

  if (shipmentError || !typedShipment) {
    throw new OrderShipmentBookingError(
      `Shipment booked with ${input.result.provider} but could not be saved locally. Tracking: ${input.result.trackingNumber}`,
      500,
      'SHIPMENT_SAVE_FAILED',
      input.result.providerShipmentId || input.result.trackingNumber
    );
  }

  const { error: quoteUpdateError } = await supabase
    .from('shipping_quotes')
    .update({ used: true })
    .eq('id', input.quote.id)
    .eq('merchant_id', input.merchantId);

  if (quoteUpdateError) {
    console.error('Shipment booked but quote could not be marked as used', {
      error: quoteUpdateError,
      orderId: input.orderId,
      provider: input.result.provider,
      quoteId: input.quote.id,
      trackingNumber: input.result.trackingNumber,
    });
  }

  return { shipmentId: typedShipment.id };
}
