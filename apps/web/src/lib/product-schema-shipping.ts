import type { OfferShippingDetails } from 'schema-dts';
import { normalizeCountryCode } from './normalize-country-code';
import type { MerchantTrustProfile } from './storefront-trust/merchant-trust-profile-types';

function isValidShippingDayRange(
  min: number | undefined,
  max: number | undefined
): min is number {
  return (
    min !== undefined &&
    max !== undefined &&
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    min >= 0 &&
    min <= max
  );
}

export function buildOfferShippingDetails(
  country: string,
  currency: string,
  trustProfile?: MerchantTrustProfile
): OfferShippingDetails | undefined {
  const normalizedCountry = normalizeCountryCode(country);
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!normalizedCountry || !/^[A-Z]{3}$/.test(normalizedCurrency)) {
    return undefined;
  }

  const shippingPolicy = trustProfile?.shippingPolicy;
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
    shippingRate: {
      '@type': 'MonetaryAmount',
      value: 0,
      currency: normalizedCurrency,
    },
    shippingDestination: {
      '@type': 'DefinedRegion',
      addressCountry: normalizedCountry,
    },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: {
        '@type': 'QuantitativeValue',
        minValue: handlingMin,
        maxValue: handlingMax,
        unitCode: 'DAY',
      },
      transitTime: {
        '@type': 'QuantitativeValue',
        minValue: transitMin,
        maxValue: transitMax,
        unitCode: 'DAY',
      },
    },
  };
}
