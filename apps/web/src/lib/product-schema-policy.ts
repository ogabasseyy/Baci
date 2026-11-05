import type {
  MerchantReturnPolicy,
  OfferShippingDetails,
  ReturnFeesEnumeration,
  ReturnMethodEnumeration,
} from 'schema-dts';
import type {
  MerchantTrustProfile,
  MerchantTrustProfileReturnFee,
  MerchantTrustProfileReturnMethod,
} from './storefront-trust/merchant-trust-profile-types';

function mapReturnMethodToSchemaUrl(
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

function mapReturnFeeToSchemaUrl(
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

export function buildOfferShippingDetails(
  country: string,
  currency: string,
  trustProfile?: MerchantTrustProfile
): OfferShippingDetails | undefined {
  const shippingPolicy = trustProfile?.shippingPolicy;
  if (
    shippingPolicy?.shippingFeeType !== 'free' ||
    !shippingPolicy.regions.some(
      (region) => region.trim().toUpperCase() === country.toUpperCase()
    ) ||
    shippingPolicy.handlingDaysMin == null ||
    shippingPolicy.handlingDaysMax == null ||
    shippingPolicy.transitDaysMin == null ||
    shippingPolicy.transitDaysMax == null
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

export function buildMerchantReturnPolicyFromTrustProfile(
  country: string,
  trustProfile?: MerchantTrustProfile
): MerchantReturnPolicy | undefined {
  const policy = trustProfile?.returnPolicy;
  if (policy?.windowDays == null) return undefined;
  const returnMethod = mapReturnMethodToSchemaUrl(policy.returnMethod);
  const returnFees = mapReturnFeeToSchemaUrl(policy.returnFees);
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: country,
    returnPolicyCountry: country,
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: policy.windowDays,
    ...(returnMethod && { returnMethod }),
    ...(returnFees && { returnFees }),
  };
}
