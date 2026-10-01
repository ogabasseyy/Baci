import type { OrderShipmentQuoteRecord } from './refresh-order-shipment-quote';
import type { BookingRequest, ShipmentItem, ShippingAddress } from './types';

export function buildOrderShipmentBookingRequest({
  items,
  orderId,
  quote,
  receiver,
  sender,
}: {
  items: ShipmentItem[];
  orderId: string;
  quote: OrderShipmentQuoteRecord;
  receiver: ShippingAddress;
  sender: ShippingAddress;
}): BookingRequest {
  return {
    orderId,
    quoteId: quote.id,
    providerRateId: quote.provider_rate_id || undefined,
    quoteMetadata: quote.provider_metadata,
    sender,
    receiver,
    items,
  };
}
