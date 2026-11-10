import type {
  MerchantReturnPolicy,
  ReturnFeesEnumeration,
  ReturnMethodEnumeration,
} from 'schema-dts';
import { normalizeCountryCode } from '@/lib/normalize-country-code';
import type {
  MerchantTrustProfile,
  MerchantTrustProfileReturnFee,
  MerchantTrustProfileReturnMethod,
} from './merchant-trust-profile-types';

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
