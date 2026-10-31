import type { OrderForShipmentReceiver } from './build-order-shipment-receiver';
import { assertQuoteReceiverMatchesOrder } from './international-quote-order-guard';
import { isNigeriaRecoveryPin } from './is-nigeria-recovery-pin';
import { normalizeAddressForQuoteMatch } from './order-quote-destination-address';
import { OrderShipmentBookingError } from './order-shipment-booking-error';
import type { QuoteRequest } from './types';

function destinationMismatch(): never {
  throw new OrderShipmentBookingError(
    'Review and confirm the shipping destination before booking.',
    400,
    'SHIPPING_QUOTE_RECEIVER_MISMATCH'
  );
}

/** Use only the merchant/order-bound saved domestic GIG checkout quote. */
export function resolveSavedGiglCheckoutDestination<
  T extends Pick<OrderForShipmentReceiver, 'shipping_address'>,
>(order: T, request: QuoteRequest): T {
  const { latitude, longitude } = request.receiver;
  const savedWithoutPin = latitude == null && longitude == null;
  // Never turn partial, malformed or foreign saved pins into station defaults.
  if (
    !savedWithoutPin &&
    (typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      Math.abs(longitude) > 180 ||
      !isNigeriaRecoveryPin(latitude, longitude))
  ) {
    destinationMismatch();
  }
  const address = order.shipping_address;
  const hasNoPin =
    address && address.latitude == null && address.longitude == null;
  if (
    normalizeAddressForQuoteMatch(
      address?.address,
      address?.city,
      address?.state
    ) !==
    normalizeAddressForQuoteMatch(
      request.receiver.address,
      request.receiver.city,
      request.receiver.state
    )
  ) {
    destinationMismatch();
  }
  if (savedWithoutPin) {
    // GIG priced this quote on the receiver station's own coordinates
    // (gigl.fetch-quote.ts). Booking resolves that same station from the saved
    // rate id and falls back to its coordinates when the receiver has no pin
    // (gigl.booking.ts), so book the order as-is. An order that has since
    // gained a pin fails this match: GIG would book on a different basis.
    assertQuoteReceiverMatchesOrder(request, order);
    return order;
  }
  if (hasNoPin) {
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
