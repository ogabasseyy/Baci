import {
  NIGERIAN_STATES,
  type RegisteredAddress,
} from '@baci/shared/contracts';

export const MERCHANT_PICKUP_QUOTE_ID = 'merchant-office-pickup';

export interface MerchantPickupLocation {
  address: string;
  city: string;
  label: string;
  state: string;
}

interface MerchantPickupSource {
  business_address?: string | null;
  business_name?: string | null;
  registered_address?: RegisteredAddress | null;
}

function canonicalState(value: string): string {
  return /^(?:abuja|fct\s*-\s*abuja)$/i.test(value)
    ? 'fct'
    : value.toLowerCase();
}

function isPostcode(value: string): boolean {
  return /^(?:\d{6}|[a-z]{2}\d{3}[a-z]{3}|[a-z]{2}\d{2}[a-z]\d{2}[a-z]{2}\d{2})$/i.test(
    value.replace(/[ -]/g, '')
  );
}

function getAddressGeography(address: string): {
  city: string;
  state: string;
} | null {
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  for (let index = parts.length - 1; index >= 2; index -= 1) {
    const stateName = canonicalState(parts[index]);
    const state = NIGERIAN_STATES.find(
      (candidate) => candidate.name.toLowerCase() === stateName.toLowerCase()
    );
    const cityLooksLikePostcode = isPostcode(parts[index - 1]);
    const suffixIsAddressMetadata = parts
      .slice(index + 1)
      .every((part) => /^(nigeria|ng)$/i.test(part) || isPostcode(part));
    if (state && suffixIsAddressMetadata) {
      return {
        city: cityLooksLikePostcode
          ? index >= 3 && !isPostcode(parts[index - 2])
            ? parts[index - 2]
            : ''
          : parts[index - 1],
        state: state.name,
      };
    }
  }
  return null;
}

export function getMerchantPickupLocation(
  merchant: MerchantPickupSource | null | undefined
): MerchantPickupLocation | undefined {
  const address =
    merchant?.business_address?.trim() ||
    merchant?.registered_address?.street?.trim();
  const country = merchant?.registered_address?.country?.trim().toLowerCase();
  const structuredState = merchant?.registered_address?.state?.trim();
  const inferred =
    address && (!country || country === 'nigeria' || country === 'ng')
      ? getAddressGeography(address)
      : null;
  const addressGeography =
    inferred &&
    (!structuredState ||
      canonicalState(structuredState) === canonicalState(inferred.state))
      ? inferred
      : null;
  const city =
    merchant?.registered_address?.city?.trim() || addressGeography?.city;
  const state =
    merchant?.registered_address?.state?.trim() || addressGeography?.state;
  if (!merchant || !address || !city || !state) return undefined;

  return {
    address,
    city,
    label: `${merchant.business_name?.trim() || 'Merchant'} Office`,
    state,
  };
}
