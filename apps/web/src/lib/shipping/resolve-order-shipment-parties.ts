import {
  type InternationalShipmentOrderItem,
  toInternationalShipmentItemsFromOrder,
} from '@/lib/shipping/international-shipment-items';
import { toDomesticBookingItems } from '@/lib/shipping/order-shipment-booking-utils';
import type {
  QuoteRequest,
  ShipmentItem,
  ShippingAddress,
} from '@/lib/shipping/types';

/**
 * Resolves the receiver, sender, and shipment items for a provider
 * booking. International quotes carry their own stored receiver/sender
 * (contact fields still come from the order context); domestic bookings
 * use the resolved order receiver and merchant sender throughout.
 */
export function resolveOrderShipmentParties({
  bookingContext,
  effectiveQuoteRequest,
  isInternationalQuote,
  merchantSender,
  orderItems,
}: {
  bookingContext: { receiver: ShippingAddress };
  effectiveQuoteRequest: QuoteRequest | null;
  isInternationalQuote: boolean;
  merchantSender: ShippingAddress | undefined;
  orderItems: InternationalShipmentOrderItem[];
}): {
  receiver: ShippingAddress;
  sender: ShippingAddress | undefined;
  items: ShipmentItem[];
} {
  const receiver =
    isInternationalQuote && effectiveQuoteRequest
      ? {
          ...effectiveQuoteRequest.receiver,
          name: bookingContext.receiver.name,
          email: bookingContext.receiver.email,
          phone: bookingContext.receiver.phone,
        }
      : bookingContext.receiver;
  const sender =
    isInternationalQuote && effectiveQuoteRequest?.sender
      ? effectiveQuoteRequest.sender
      : merchantSender;
  const items =
    isInternationalQuote && effectiveQuoteRequest
      ? toInternationalShipmentItemsFromOrder(
          orderItems,
          effectiveQuoteRequest.items
        )
      : toDomesticBookingItems(orderItems, effectiveQuoteRequest?.items);
  return { receiver, sender, items };
}
