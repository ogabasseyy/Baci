import type { OrderCreateInput } from '@/schemas/orders';
import type { parseStoredQuoteRequest } from './order-shipment-booking-utils';

export type OrderShippingAddressForQuote = NonNullable<
  OrderCreateInput['shipping_address']
>;

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function matchesOptionalText(
  orderValue: string | null | undefined,
  quoteValue: string | null | undefined
): boolean {
  const normalizedOrderValue = normalizeText(orderValue);
  const normalizedQuoteValue = normalizeText(quoteValue);
  if (!normalizedOrderValue && !normalizedQuoteValue) return true;
  if (!normalizedOrderValue || !normalizedQuoteValue) return true;
  return normalizedOrderValue === normalizedQuoteValue;
}

export function normalizeAddressForQuoteMatch(
  address: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined
): string {
  const normalizedAddress = normalizeText(address);
  const normalizedCity = normalizeText(city);
  const normalizedState = normalizeText(state);
  if (!normalizedCity && !normalizedState) {
    return normalizedAddress;
  }
  const suffix = `, ${normalizedCity}, ${normalizedState}`;
  if (normalizedAddress.endsWith(suffix)) {
    return normalizedAddress.slice(0, -suffix.length).trim();
  }
  return normalizedAddress;
}

function matchesDomesticGiglQuoteAddress(
  shippingAddress: OrderShippingAddressForQuote,
  receiver: NonNullable<ReturnType<typeof parseStoredQuoteRequest>>['receiver']
): boolean {
  if (
    normalizeText(shippingAddress.city) !== normalizeText(receiver.city) ||
    normalizeText(shippingAddress.state) !== normalizeText(receiver.state)
  ) {
    return false;
  }

  const quoteStreet = normalizeText(receiver.address);
  const orderStreet = normalizeAddressForQuoteMatch(
    shippingAddress.address,
    shippingAddress.city,
    shippingAddress.state
  );
  return orderStreet === quoteStreet;
}

export function matchesQuoteDestination(
  shippingAddress: OrderShippingAddressForQuote,
  quoteRequest: NonNullable<ReturnType<typeof parseStoredQuoteRequest>>
): boolean {
  const receiver = quoteRequest.receiver;
  const addressMatches =
    quoteRequest.shipmentType === 'domestic'
      ? matchesDomesticGiglQuoteAddress(shippingAddress, receiver)
      : normalizeText(shippingAddress.address) ===
        normalizeText(receiver.address);

  return (
    addressMatches &&
    normalizeText(shippingAddress.city) === normalizeText(receiver.city) &&
    normalizeText(shippingAddress.state) === normalizeText(receiver.state) &&
    matchesOptionalText(shippingAddress.country, receiver.country) &&
    matchesOptionalText(shippingAddress.countryCode, receiver.countryCode) &&
    matchesOptionalText(shippingAddress.postalCode, receiver.postalCode)
  );
}
