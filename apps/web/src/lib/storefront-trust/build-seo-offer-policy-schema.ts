import type {
  MerchantReturnPolicy,
  OfferShippingDetails,
  ReturnFeesEnumeration,
  ReturnMethodEnumeration,
} from 'schema-dts';
import { normalizeCountryCode } from '@/lib/normalize-country-code';
import type {
  MerchantTrustProfile,
  MerchantTrustProfileReturnFee,
  MerchantTrustProfileReturnMethod,
} from './merchant-trust-profile-types';

export function mapReturnMethodToSchemaUrl(
  returnMethod: MerchantTrustProfileReturnMethod | undefined
): ReturnMethodEnumeration | undefined {
  switch (returnMethod) {
    case 'mail':
    case 'carrier_dropoff':
      return 'https://schema.org/ReturnByMail';
    case 'in_store':
      return 'https://schema.org/ReturnInStore';
    default:
      return undefined;
  }
}

export function mapReturnFeeToSchemaUrl(
  returnFees: MerchantTrustProfileReturnFee | undefined
): ReturnFeesEnumeration | undefined {
  switch (returnFees) {
    case 'free':
      return 'https://schema.org/FreeReturn';
    case 'customer_pays':
      return 'https://schema.org/ReturnShippingFees';
    case 'original_shipping_deducted':
      return 'https://schema.org/OriginalShippingFees';
    default:
      return undefined;
  }
}

export function buildMerchantReturnPolicy(
  country: string,
  trustProfile?: MerchantTrustProfile
): MerchantReturnPolicy | undefined {
  const normalizedCountry = normalizeCountryCode(country);
  if (!normalizedCountry) {
    return undefined;
  }
  const returnPolicy = trustProfile?.returnPolicy;
  const windowDays = returnPolicy?.windowDays;
  if (
    windowDays === undefined ||
    !Number.isInteger(windowDays) ||
    windowDays < 0
  ) {
    return undefined;
  }
  if (windowDays === 0) {
    return {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: normalizedCountry,
      returnPolicyCountry: normalizedCountry,
      returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
    };
  }

  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: normalizedCountry,
    returnPolicyCountry: normalizedCountry,
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: windowDays,
    ...(returnPolicy?.returnMethod && {
      returnMethod: mapReturnMethodToSchemaUrl(returnPolicy.returnMethod),
    }),
    ...(returnPolicy?.returnFees && {
      returnFees: mapReturnFeeToSchemaUrl(returnPolicy.returnFees),
    }),
  };
}

export const buildMerchantReturnPolicyFromTrustProfile =
  buildMerchantReturnPolicy;

export function isValidShippingDayRange(
  min?: number,
  max?: number
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

export function toDeliveryDayRange(min: number, max: number) {
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
