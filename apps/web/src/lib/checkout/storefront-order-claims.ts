import {
  ORDER_BINDING_VARIANTS,
  type OrderBindingVariant,
} from '@/lib/cart/order-binding-types';

export const STOREFRONT_CHECKOUT_VARIANTS = [
  ...ORDER_BINDING_VARIANTS,
  'redvault',
] as const;
export type StorefrontCheckoutVariant = OrderBindingVariant | 'redvault';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const ISO_SUBDIVISION_CODE_PATTERN = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;
const MAX_POSTGRES_BIGINT_REVISION = '9223372036854775807';
const MAX_POSTGRES_INT = 2_147_483_647;
const CHECKOUT_IDEMPOTENCY_KEY_MIN_BYTES = 16;
const CHECKOUT_IDEMPOTENCY_KEY_MAX_BYTES = 128;
const CHECKOUT_BINDING_OPAQUE_ID_MAX_BYTES = 128;

/**
 * Server-verified merchant rate context. All money values are integer minor
 * units. This signed transport claim is not enforcement by itself; the order
 * binder must independently validate it against session and current DB state.
 */
export type StorefrontMerchantRateAttestation = {
  shippingRateId: string;
  shippingConfigRevision: string;
  /** Validated pre-discount goods plus server-rated assurance, excluding delivery. */
  canonicalSubtotalMinor: number;
  destinationCountryCode: string;
  destinationSubdivisionCode: string | null;
  shippingFeeMinor: number;
  fulfillmentKind: 'ship' | 'pickup';
};

/** Server-verified checkout identity; never contains session bearer material. */
type StorefrontCheckoutBindingBase = {
  cartId: string;
  checkoutSessionId: string;
  checkoutGeneration: number;
  cartVersion: number;
  principalId: string;
  checkoutVariant: StorefrontCheckoutVariant;
  deliveryMode: 'merchant_rate' | 'no_merchant_rate' | 'replay';
};

export type StorefrontCheckoutBinding =
  | (StorefrontCheckoutBindingBase & {
      identityKind: 'idempotent';
      checkoutVariant: Exclude<StorefrontCheckoutVariant, 'quiz_voucher'>;
      idempotencyKey: string;
      /** SHA-256 hex of the canonical request hash submitted to the order RPC. */
      checkoutRequestHash: string;
    })
  | (StorefrontCheckoutBindingBase & {
      identityKind: 'quiz_voucher';
      checkoutVariant: 'quiz_voucher';
      voucherAwardId: string;
    });

type ValidatedStorefrontMerchantRateAttestation = {
  version: 1;
  merchant_id: string;
  shipping_rate_id: string;
  shipping_config_revision: string;
  canonical_subtotal_minor: number;
  destination_country_code: string;
  destination_subdivision_code: string | null;
  shipping_fee_minor: number;
  fulfillment_kind: 'ship' | 'pickup';
};

type ValidatedStorefrontCheckoutBinding = {
  version: 1;
  cart_id: string;
  checkout_session_id: string;
  checkout_generation: number;
  cart_version: number;
  principal_id: string;
  delivery_mode: 'merchant_rate' | 'no_merchant_rate' | 'replay';
  identity_kind: 'idempotent' | 'quiz_voucher';
  checkout_variant: StorefrontCheckoutVariant;
  idempotency_key?: string;
  checkout_request_hash?: string;
  voucher_award_id?: string;
};

export function validateCheckoutBinding(
  checkoutBinding: StorefrontCheckoutBinding
): ValidatedStorefrontCheckoutBinding {
  const cartId = checkoutBinding.cartId.trim().toLowerCase();
  const checkoutSessionId = checkoutBinding.checkoutSessionId
    .trim()
    .toLowerCase();
  if (!UUID_PATTERN.test(cartId) || !UUID_PATTERN.test(checkoutSessionId)) {
    throw new Error('Checkout binding requires UUID cart and session ids');
  }
  for (const [field, value] of [
    ['checkout generation', checkoutBinding.checkoutGeneration],
    ['cart version', checkoutBinding.cartVersion],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_POSTGRES_INT) {
      throw new Error(
        `Checkout binding ${field} must be a positive PostgreSQL integer`
      );
    }
  }
  const principalId = checkoutBinding.principalId;
  const principalIdBytes = Buffer.byteLength(principalId, 'utf8');
  if (
    principalId.trim().length === 0 ||
    principalIdBytes > CHECKOUT_BINDING_OPAQUE_ID_MAX_BYTES
  ) {
    throw new Error('Checkout binding principal id is malformed');
  }
  if (
    checkoutBinding.deliveryMode !== 'merchant_rate' &&
    checkoutBinding.deliveryMode !== 'no_merchant_rate' &&
    checkoutBinding.deliveryMode !== 'replay'
  ) {
    throw new Error('Checkout binding delivery mode is invalid');
  }
  const checkoutVariantValue: string = checkoutBinding.checkoutVariant;
  if (
    !STOREFRONT_CHECKOUT_VARIANTS.some(
      (variant) => variant === checkoutVariantValue
    ) ||
    (checkoutBinding.identityKind === 'quiz_voucher' &&
      checkoutVariantValue !== 'quiz_voucher') ||
    (checkoutBinding.identityKind === 'idempotent' &&
      checkoutVariantValue === 'quiz_voucher')
  ) {
    throw new Error('Checkout binding variant does not match its identity');
  }
  const validated: ValidatedStorefrontCheckoutBinding = {
    version: 1,
    cart_id: cartId,
    checkout_session_id: checkoutSessionId,
    checkout_generation: checkoutBinding.checkoutGeneration,
    cart_version: checkoutBinding.cartVersion,
    principal_id: principalId,
    delivery_mode: checkoutBinding.deliveryMode,
    identity_kind: checkoutBinding.identityKind,
    checkout_variant: checkoutBinding.checkoutVariant,
  };
  if (checkoutBinding.identityKind === 'idempotent') {
    const idempotencyKey = checkoutBinding.idempotencyKey;
    const idempotencyKeyBytes = Buffer.byteLength(idempotencyKey, 'utf8');
    if (
      idempotencyKey !== idempotencyKey.trim() ||
      idempotencyKeyBytes < CHECKOUT_IDEMPOTENCY_KEY_MIN_BYTES ||
      idempotencyKeyBytes > CHECKOUT_IDEMPOTENCY_KEY_MAX_BYTES
    ) {
      throw new Error('Checkout binding idempotency key is malformed');
    }
    if (!/^[0-9a-f]{64}$/.test(checkoutBinding.checkoutRequestHash)) {
      throw new Error('Checkout binding request hash must be SHA-256 hex');
    }
    validated.idempotency_key = idempotencyKey;
    validated.checkout_request_hash = checkoutBinding.checkoutRequestHash;
  } else if (checkoutBinding.identityKind === 'quiz_voucher') {
    const voucherAwardId = checkoutBinding.voucherAwardId.trim().toLowerCase();
    if (!UUID_PATTERN.test(voucherAwardId)) {
      throw new Error('Voucher checkout binding requires a UUID award id');
    }
    validated.voucher_award_id = voucherAwardId;
  } else {
    throw new Error('Checkout binding identity kind is invalid');
  }
  return validated;
}

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
