import type { OfferShippingDetails } from 'schema-dts';
import { normalizeCountryCode } from '@/lib/normalize-country-code';
import type { MerchantTrustProfile } from './merchant-trust-profile-types';

function isValidShippingDayRange(min?: number, max?: number): min is number {
  return (
    min !== undefined &&
    max !== undefined &&
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    min >= 0 &&
    min <= max
  );
}

function toDeliveryDayRange(min: number, max: number) {
  return {
    '@type': 'QuantitativeValue' as const,
    minValue: min,
    maxValue: max,
    unitCode: 'DAY',
  };
}

export function buildOfferShippingDetails(
  country: string,
  currency: string,
  trustProfile?: MerchantTrustProfile
): OfferShippingDetails | undefined {
  const normalizedCountry = normalizeCountryCode(country);
  if (!normalizedCountry) {
    return undefined;
  }
  const shippingPolicy = trustProfile?.shippingPolicy;
  // This projection has no numeric shipping charge. Only an explicitly free,
  // exact country policy with complete confirmed timings can form this object.
  // Conditional local offers cannot establish a country-wide shipping rate.
  if (
    shippingPolicy?.shippingFeeType !== 'free' ||
    !shippingPolicy.regions.some(
      (region) => normalizeCountryCode(region) === normalizedCountry
    )
  ) {
    return undefined;
  }

  const handlingMin = shippingPolicy.handlingDaysMin;
  const handlingMax = shippingPolicy.handlingDaysMax;
  const transitMin = shippingPolicy.transitDaysMin;
  const transitMax = shippingPolicy.transitDaysMax;

  if (
    handlingMax === undefined ||
    transitMax === undefined ||
    !isValidShippingDayRange(handlingMin, handlingMax) ||
    !isValidShippingDayRange(transitMin, transitMax)
  ) {
    return undefined;
  }

  return {
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: 0, currency },
    shippingDestination: {
      '@type': 'DefinedRegion',
      addressCountry: normalizedCountry,
    },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: toDeliveryDayRange(handlingMin, handlingMax),
      transitTime: toDeliveryDayRange(transitMin, transitMax),
    },
  };
}
