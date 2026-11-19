import type {
  MerchantReturnPolicy,
  ReturnFeesEnumeration,
  ReturnMethodEnumeration,
} from 'schema-dts';
import { normalizeCountryCode } from './normalize-country-code';
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

export function buildMerchantReturnPolicyFromTrustProfile(
  country: string,
  trustProfile?: MerchantTrustProfile
): MerchantReturnPolicy | undefined {
  const normalizedCountry = normalizeCountryCode(country);
  if (!normalizedCountry) {
    return undefined;
  }
  const policy = trustProfile?.returnPolicy;
  const windowDays = policy?.windowDays;
  if (windowDays == null || !Number.isInteger(windowDays) || windowDays < 0) {
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
  const returnMethod = mapReturnMethodToSchemaUrl(policy?.returnMethod);
  const returnFees = mapReturnFeeToSchemaUrl(policy?.returnFees);
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: normalizedCountry,
    returnPolicyCountry: normalizedCountry,
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: windowDays,
    ...(returnMethod && { returnMethod }),
    ...(returnFees && { returnFees }),
  };
}
