import type { OrderForShipmentReceiver } from './build-order-shipment-receiver';
import { assertQuoteReceiverMatchesOrder } from './international-quote-order-guard';
import { normalizeAddressForQuoteMatch } from './order-quote-destination-address';
import { OrderShipmentBookingError } from './order-shipment-booking-error';
import type { QuoteRequest } from './types';

/** Use only the merchant/order-bound saved domestic GIG checkout quote. */
export function resolveSavedGiglCheckoutDestination<
  T extends Pick<OrderForShipmentReceiver, 'shipping_address'>,
>(order: T, request: QuoteRequest): T {
  const { latitude, longitude } = request.receiver;
  // Never turn missing or malformed saved pins into carrier station defaults.
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  ) {
    throw new OrderShipmentBookingError(
      'Review and confirm the shipping destination before booking.',
      400,
      'SHIPPING_QUOTE_RECEIVER_MISMATCH'
    );
  }
  const address = order.shipping_address;
  const hasNoPin =
    address && address.latitude == null && address.longitude == null;
  if (hasNoPin) {
    if (
      normalizeAddressForQuoteMatch(
        address.address,
        address.city,
        address.state
      ) !==
      normalizeAddressForQuoteMatch(
        request.receiver.address,
        request.receiver.city,
        request.receiver.state
      )
    ) {
      throw new OrderShipmentBookingError(
        'Review and confirm the shipping destination before booking.',
        400,
        'SHIPPING_QUOTE_RECEIVER_MISMATCH'
      );
    }
    assertQuoteReceiverMatchesOrder(
      {
        ...request,
        receiver: {
          ...request.receiver,
          latitude: undefined,
          longitude: undefined,
        },
      },
      order
    );
  }
  const resolved = hasNoPin
    ? { ...order, shipping_address: { ...address, latitude, longitude } }
    : order;
  // This still checks street, locality, country, postal code AND explicit pins.
  // Only absent pairs are supplied; partial/invalid/conflicting pairs fail.
  assertQuoteReceiverMatchesOrder(request, resolved);
  return resolved;
}
