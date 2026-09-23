import { normalizeAddressForQuoteMatch } from './order-quote-destination-address';
import type { QuoteRequest } from './types';

export type QuoteReceiverMatchAddress = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  countryCode?: string | null;
};

export function normalizeReceiverMatchText(
  value: string | null | undefined
): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hasComparableText(value: string | null | undefined): boolean {
  return normalizeReceiverMatchText(value).length > 0;
}

function effectiveDomesticCountry(value: string | null | undefined): string {
  return hasComparableText(value)
    ? normalizeReceiverMatchText(value)
    : 'nigeria';
}

function effectiveDomesticCountryCode(
  value: string | null | undefined
): string {
  return hasComparableText(value) ? normalizeReceiverMatchText(value) : 'ng';
}

export function matchesOptionalReceiverText(
  orderValue: string | null | undefined,
  quoteValue: string | null | undefined
): boolean {
  const hasOrderValue = hasComparableText(orderValue);
  const hasQuoteValue = hasComparableText(quoteValue);
  if (!hasOrderValue && !hasQuoteValue) return true;
  if (!hasOrderValue || !hasQuoteValue) return false;
  return (
    normalizeReceiverMatchText(orderValue) ===
    normalizeReceiverMatchText(quoteValue)
  );
}

export function matchesReceiverCountryFields(
  orderAddress: QuoteReceiverMatchAddress,
  quoteAddress: QuoteRequest['receiver'],
  shipmentType: QuoteRequest['shipmentType']
): boolean {
  if (shipmentType === 'domestic') {
    return (
      effectiveDomesticCountry(orderAddress.country) ===
        effectiveDomesticCountry(quoteAddress.country) &&
      effectiveDomesticCountryCode(orderAddress.countryCode) ===
        effectiveDomesticCountryCode(quoteAddress.countryCode)
    );
  }
  return (
    matchesOptionalReceiverText(orderAddress.country, quoteAddress.country) &&
    matchesOptionalReceiverText(
      orderAddress.countryCode,
      quoteAddress.countryCode
    )
  );
}

export function matchesDomesticReceiverAddress(
  orderAddress: QuoteReceiverMatchAddress,
  quoteAddress: QuoteRequest['receiver']
): boolean {
  const quoteStreet = normalizeReceiverMatchText(quoteAddress.address);
  const orderStreet = normalizeAddressForQuoteMatch(
    orderAddress.address,
    orderAddress.city,
    orderAddress.state
  );
  if (orderStreet === quoteStreet) {
    return true;
  }
  const normalizedOrderAddress = normalizeReceiverMatchText(
    orderAddress.address
  );
  return normalizedOrderAddress.startsWith(`${quoteStreet},`);
}
