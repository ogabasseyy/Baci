import type {
  StorefrontMerchantRateAttestation,
  ValidatedStorefrontCheckoutBinding,
  ValidatedStorefrontMerchantRateAttestation,
} from './storefront-order-claim-types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const ISO_SUBDIVISION_CODE_PATTERN = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;
const MAX_POSTGRES_BIGINT_REVISION = '9223372036854775807';

function isSafeMinorAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateMerchantRateAttestation({
  merchantId,
  attestation,
  checkoutBinding,
  hasCanonicalDeliveryMetadata,
}: {
  merchantId: string;
  attestation: StorefrontMerchantRateAttestation;
  checkoutBinding: ValidatedStorefrontCheckoutBinding;
  hasCanonicalDeliveryMetadata: boolean;
}): ValidatedStorefrontMerchantRateAttestation {
  const normalizedMerchantId = merchantId.trim().toLowerCase();
  const shippingRateId = attestation.shippingRateId.trim().toLowerCase();
  const countryCode = attestation.destinationCountryCode;
  const subdivisionCode = attestation.destinationSubdivisionCode;

  if (!UUID_PATTERN.test(normalizedMerchantId)) {
    throw new Error('Merchant rate attestation requires a UUID merchant id');
  }
  if (!UUID_PATTERN.test(shippingRateId)) {
    throw new Error(
      'Merchant rate attestation requires a UUID shipping rate id'
    );
  }
  if (
    !/^[1-9][0-9]*$/.test(attestation.shippingConfigRevision) ||
    attestation.shippingConfigRevision.length >
      MAX_POSTGRES_BIGINT_REVISION.length ||
    (attestation.shippingConfigRevision.length ===
      MAX_POSTGRES_BIGINT_REVISION.length &&
      attestation.shippingConfigRevision > MAX_POSTGRES_BIGINT_REVISION)
  ) {
    throw new Error(
      'Merchant rate attestation requires a decimal revision string'
    );
  }
  if (!isSafeMinorAmount(attestation.canonicalSubtotalMinor)) {
    throw new Error(
      'Merchant rate attestation subtotal must be safe integer minor units'
    );
  }
  if (!isSafeMinorAmount(attestation.shippingFeeMinor)) {
    throw new Error(
      'Merchant rate attestation fee must be safe integer minor units'
    );
  }
  if (!ISO_COUNTRY_CODE_PATTERN.test(countryCode)) {
    throw new Error(
      'Merchant rate attestation country must be normalized ISO-2'
    );
  }
  if (
    subdivisionCode !== null &&
    (!ISO_SUBDIVISION_CODE_PATTERN.test(subdivisionCode) ||
      subdivisionCode.slice(0, 2) !== countryCode)
  ) {
    throw new Error(
      'Merchant rate attestation subdivision must match its country'
    );
  }
  if (
    attestation.fulfillmentKind !== 'ship' &&
    attestation.fulfillmentKind !== 'pickup'
  ) {
    throw new Error('Merchant rate attestation fulfillment kind is invalid');
  }
  if (!hasCanonicalDeliveryMetadata) {
    throw new Error(
      'Merchant rate attestation requires canonical delivery metadata'
    );
  }
  if (checkoutBinding.delivery_mode !== 'merchant_rate') {
    throw new Error(
      'Merchant rate attestation requires merchant_rate checkout mode'
    );
  }

  return {
    version: 1,
    merchant_id: normalizedMerchantId,
    shipping_rate_id: shippingRateId,
    shipping_config_revision: attestation.shippingConfigRevision,
    canonical_subtotal_minor: attestation.canonicalSubtotalMinor,
    destination_country_code: countryCode,
    destination_subdivision_code: subdivisionCode,
    shipping_fee_minor: attestation.shippingFeeMinor,
    fulfillment_kind: attestation.fulfillmentKind,
  };
}
