import { areLocationStateLabelsEquivalent } from '@baci/shared/lib';
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

type DestinationField =
  | 'address'
  | 'city'
  | 'state'
  | 'country'
  | 'countryCode'
  | 'postalCode';

export function getQuoteDestinationMismatchFields(
  shippingAddress: OrderShippingAddressForQuote,
  quoteRequest: NonNullable<ReturnType<typeof parseStoredQuoteRequest>>
): DestinationField[] {
  const { receiver, shipmentType } = quoteRequest;
  const mismatches: DestinationField[] = [];
  const domestic = shipmentType === 'domestic';
  const quoteCountryCode = normalizeText(receiver.countryCode);
  const nigerian =
    domestic &&
    (quoteCountryCode
      ? quoteCountryCode === 'ng'
      : normalizeText(receiver.country) === 'nigeria');

  if (normalizeText(shippingAddress.city) !== normalizeText(receiver.city)) {
    mismatches.push('city');
  }
  if (
    normalizeText(shippingAddress.state) !== normalizeText(receiver.state) &&
    !(
      nigerian &&
      areLocationStateLabelsEquivalent(
        shippingAddress.state ?? '',
        receiver.state ?? ''
      )
    )
  ) {
    mismatches.push('state');
  }
  if (
    normalizeText(shippingAddress.address) !==
      normalizeText(receiver.address) &&
    (!domestic ||
      normalizeAddressForQuoteMatch(
        shippingAddress.address,
        shippingAddress.city,
        shippingAddress.state
      ) !==
        normalizeAddressForQuoteMatch(
          receiver.address,
          receiver.city,
          receiver.state
        ))
  ) {
    mismatches.push('address');
  }
  for (const field of ['country', 'countryCode', 'postalCode'] as const) {
    if (!matchesOptionalText(shippingAddress[field], receiver[field])) {
      mismatches.push(field);
    }
  }
  return mismatches;
}

export function matchesQuoteDestination(
  shippingAddress: OrderShippingAddressForQuote,
  quoteRequest: NonNullable<ReturnType<typeof parseStoredQuoteRequest>>
): boolean {
  return (
    getQuoteDestinationMismatchFields(shippingAddress, quoteRequest).length ===
    0
  );
}
