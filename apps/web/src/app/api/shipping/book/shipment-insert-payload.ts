import type {
  ShipmentBookingResult,
  ShipmentItem,
  ShippingAddress,
} from '@/lib/shipping/types';

interface ShippingQuoteForShipmentInsert {
  id: string;
  price: number;
  currency: string;
  estimated_days: number | null;
}

interface BuildShipmentInsertPayloadParams {
  orderId: string;
  merchantId: string;
  senderInfo: ShippingAddress;
  receiver: ShippingAddress;
  items: ShipmentItem[];
  quote: ShippingQuoteForShipmentInsert;
  result: ShipmentBookingResult;
}

export function buildShipmentInsertPayload({
  orderId,
  merchantId,
  senderInfo,
  receiver,
  items,
  quote,
  result,
}: BuildShipmentInsertPayloadParams) {
  return {
    order_id: orderId,
    merchant_id: merchantId,
    provider: result.provider,
    provider_shipment_id: result.providerShipmentId,
    shipping_quote_id: quote.id,
    tracking_number: result.trackingNumber,
    carrier_name: result.carrierName,
    status: result.status,
    sender_address: senderInfo,
    receiver_address: receiver,
    items,
    price: quote.price,
    currency: quote.currency,
    estimated_delivery_days: quote.estimated_days,
    is_station_pickup: result.isStationPickup ?? false,
    station_name: result.pickupStationName ?? null,
    station_address: result.pickupStationAddress ?? null,
    pickup_scheduled_at: result.pickupScheduledAt?.toISOString(),
    label_url: result.labelUrl,
    provider_response: result.rawResponse,
  };
}
