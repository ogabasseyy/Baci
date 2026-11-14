export const MERCHANT_RATE_ATTESTATION_ENV =
  'BACI_SHARED_CART_MERCHANT_RATE_ATTESTATION';

export function isMerchantRateAttestationEnabled(
  value = process.env[MERCHANT_RATE_ATTESTATION_ENV]
): boolean {
  return value?.trim().toLowerCase() === 'true';
}
