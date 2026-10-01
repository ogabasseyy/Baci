import { assertQuoteItemsMatchOrder } from './international-quote-items-match';
import {
  matchesDomesticReceiverAddress,
  matchesOptionalReceiverText,
  matchesReceiverCountryFields,
  normalizeReceiverMatchText,
} from './international-quote-receiver-match';
import { OrderShipmentBookingError } from './order-shipment-booking-error';
import { toQuoteComparableOrderItems } from './order-shipment-booking-utils';
import type { QuoteRequest } from './types';

type OrderShippingAddress = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  countryCode?: string | null;
  postal_code?: string | null;
  postalCode?: string | null;
  latitude?: unknown;
  longitude?: unknown;
};

export type InternationalQuoteOrder = {
  shipping_address: OrderShippingAddress | null;
  /** Raw order_items rows; nested product.dimensions are flattened for compare. */
  order_items: unknown[] | null;
};

function normalizeText(value: string | null | undefined): string {
  return normalizeReceiverMatchText(value);
}

function matchesOptionalText(
  orderValue: string | null | undefined,
  quoteValue: string | null | undefined
): boolean {
  return matchesOptionalReceiverText(orderValue, quoteValue);
}

const COORDINATE_TOLERANCE = 1e-6;

type CoordinateReading =
  | { status: 'absent' | 'invalid' }
  | { status: 'valid'; value: number };

function readCoordinate(
  value: unknown,
  minimum: number,
  maximum: number
): CoordinateReading {
  if (value === null || value === undefined) return { status: 'absent' };
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value.trim())
        : undefined;
  if (
    numericValue === undefined ||
    !Number.isFinite(numericValue) ||
    numericValue < minimum ||
    numericValue > maximum
  ) {
    return { status: 'invalid' };
  }
  return { status: 'valid', value: numericValue };
}

function matchesCoordinatePair(
  orderAddress: OrderShippingAddress,
  quoteAddress: QuoteRequest['receiver']
): boolean {
  const orderLatitude = readCoordinate(orderAddress.latitude, -90, 90);
  const orderLongitude = readCoordinate(orderAddress.longitude, -180, 180);
  const quoteLatitude = readCoordinate(quoteAddress.latitude, -90, 90);
  const quoteLongitude = readCoordinate(quoteAddress.longitude, -180, 180);
  const orderHasNoCoordinates =
    orderLatitude.status === 'absent' && orderLongitude.status === 'absent';
  const quoteHasNoCoordinates =
    quoteLatitude.status === 'absent' && quoteLongitude.status === 'absent';

  if (orderHasNoCoordinates && quoteHasNoCoordinates) return true;
  if (
    orderLatitude.status !== 'valid' ||
    orderLongitude.status !== 'valid' ||
    quoteLatitude.status !== 'valid' ||
    quoteLongitude.status !== 'valid'
  ) {
    return false;
  }

  return (
    Math.abs(orderLatitude.value - quoteLatitude.value) <=
      COORDINATE_TOLERANCE &&
    Math.abs(orderLongitude.value - quoteLongitude.value) <=
      COORDINATE_TOLERANCE
  );
}

function throwMismatch(
  message = 'The saved international shipping quote no longer matches this order. Please get a new quote before shipping.',
  code = 'INTERNATIONAL_QUOTE_ORDER_MISMATCH'
): never {
  throw new OrderShipmentBookingError(message, 400, code);
}

/**
 * Verify that a quote's attested receiver still matches the order destination.
 *
 * Shipping quotes are calculated from the receiver address. This check is
 * intentionally independent of shipment type so domestic bookings cannot use
 * a quote calculated for a different address after an order edit.
 */
export function assertQuoteReceiverMatchesOrder(
  quoteRequest: QuoteRequest,
  order: Pick<InternationalQuoteOrder, 'shipping_address'>
): void {
  const orderAddress = order.shipping_address;
  if (!orderAddress) {
    throwMismatch(
      'The saved shipping quote no longer matches this order destination. Please get a new quote before shipping.',
      'SHIPPING_QUOTE_RECEIVER_MISMATCH'
    );
  }
  const addressMatches =
    quoteRequest.shipmentType === 'domestic'
      ? matchesDomesticReceiverAddress(orderAddress, quoteRequest.receiver)
      : normalizeText(orderAddress.address) ===
        normalizeText(quoteRequest.receiver.address);
  const countryMatches = matchesReceiverCountryFields(
    orderAddress,
    quoteRequest.receiver,
    quoteRequest.shipmentType
  );
  const orderLatitude = readCoordinate(orderAddress.latitude, -90, 90);
  const orderLongitude = readCoordinate(orderAddress.longitude, -180, 180);
  const quoteLatitude = readCoordinate(quoteRequest.receiver.latitude, -90, 90);
  const quoteLongitude = readCoordinate(
    quoteRequest.receiver.longitude,
    -180,
    180
  );
  const hasMatchingFiniteCoordinates =
    orderLatitude.status === 'valid' &&
    orderLongitude.status === 'valid' &&
    quoteLatitude.status === 'valid' &&
    quoteLongitude.status === 'valid' &&
    Math.abs(orderLatitude.value - quoteLatitude.value) <=
      COORDINATE_TOLERANCE &&
    Math.abs(orderLongitude.value - quoteLongitude.value) <=
      COORDINATE_TOLERANCE;
  const orderLocalityBlank =
    !normalizeText(orderAddress.city) && !normalizeText(orderAddress.state);
  const localityMatches =
    hasMatchingFiniteCoordinates && orderLocalityBlank
      ? true
      : normalizeText(orderAddress.city) ===
          normalizeText(quoteRequest.receiver.city) &&
        normalizeText(orderAddress.state) ===
          normalizeText(quoteRequest.receiver.state);
  if (
    !addressMatches ||
    !localityMatches ||
    !countryMatches ||
    !matchesOptionalText(
      orderAddress.postalCode ?? orderAddress.postal_code,
      quoteRequest.receiver.postalCode
    ) ||
    !matchesCoordinatePair(orderAddress, quoteRequest.receiver)
  ) {
    throwMismatch(
      'The saved shipping quote no longer matches this order destination. Please get a new quote before shipping.',
      'SHIPPING_QUOTE_RECEIVER_MISMATCH'
    );
  }
}

export function assertInternationalQuoteMatchesOrder(
  quoteRequest: QuoteRequest,
  order: InternationalQuoteOrder
): void {
  try {
    assertQuoteReceiverMatchesOrder(quoteRequest, order);
  } catch (error) {
    if (
      error instanceof OrderShipmentBookingError &&
      error.code === 'SHIPPING_QUOTE_RECEIVER_MISMATCH'
    ) {
      throwMismatch();
    }
    throw error;
  }

  // Flatten nested product.dimensions the same way domestic booking does so
  // newly added package size is visible against legacy quotes that omit it.
  assertQuoteItemsMatchOrder(
    quoteRequest,
    toQuoteComparableOrderItems(order.order_items),
    {
      message:
        'The saved international shipping quote no longer matches this order. Please get a new quote before shipping.',
      code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
    }
  );
}
