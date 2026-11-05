import type { OfferShippingDetails } from 'schema-dts';
import { getCountryByCode } from './countries';
import type { MerchantTrustProfile } from './storefront-trust/merchant-trust-profile-types';

export function buildOfferShippingDetails(
  country: string,
  currency: string,
  trustProfile?: MerchantTrustProfile
): OfferShippingDetails | undefined {
  const shippingPolicy = trustProfile?.shippingPolicy;
  if (
    shippingPolicy?.shippingFeeType !== 'free' ||
    !shippingPolicy.regions.some(
      (region) =>
        region.trim().toUpperCase() === country.toUpperCase() ||
        getCountryByCode(region.trim())?.code === country.toUpperCase()
    ) ||
    shippingPolicy.handlingDaysMin == null ||
    shippingPolicy.handlingDaysMax == null ||
    shippingPolicy.transitDaysMin == null ||
    shippingPolicy.transitDaysMax == null ||
    shippingPolicy.handlingDaysMin > shippingPolicy.handlingDaysMax ||
    shippingPolicy.transitDaysMin > shippingPolicy.transitDaysMax
  )
    return undefined;
  const handlingMin = shippingPolicy.handlingDaysMin;
  const handlingMax = shippingPolicy.handlingDaysMax;
  const transitMin = shippingPolicy.transitDaysMin;
  const transitMax = shippingPolicy.transitDaysMax;

  return {
    '@type': 'OfferShippingDetails',
    shippingRate: {
      '@type': 'MonetaryAmount',
      value: 0,
      currency,
    },
    shippingDestination: {
      '@type': 'DefinedRegion',
      addressCountry: country,
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
