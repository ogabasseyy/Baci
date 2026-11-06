import { resolveSubdivisionCode } from '@/lib/shipping/merchant-rates/subdivisions';
import type { StorefrontCheckoutVariant } from './storefront-order-claims';
import type {
  StorefrontCheckoutBinding,
  StorefrontMerchantRateAttestation,
} from './storefront-order-rpc-client';

export const MERCHANT_RATE_ATTESTATION_ENV =
  'BACI_SHARED_CART_MERCHANT_RATE_ATTESTATION';

export type SharedCartRateBinding = {
  cart_id: string;
  checkout_session_id: string;
  checkout_generation: number;
  cart_version: number;
};

/** Marker belongs in the binder's JSON p_args; it is not an inner RPC arg. */
export function buildSharedCartShippingRateMarker({
  enabled,
  sharedCart,
  shippingRateId,
}: {
  enabled: boolean;
  sharedCart: SharedCartRateBinding | undefined;
  shippingRateId: string | null | undefined;
}): { p_shipping_rate_id: string | null } | null {
  if (!enabled || !sharedCart) return null;
  return { p_shipping_rate_id: shippingRateId ?? null };
}

export function buildStorefrontCheckoutBinding({
  enabled,
  sharedCart,
  principalId,
  idempotencyKey,
  checkoutRequestHash,
  voucherAwardId,
  hasQuizVoucherItem,
  deliveryMode,
  checkoutVariant,
}: {
  enabled: boolean;
  sharedCart: SharedCartRateBinding | undefined;
  principalId: string | null;
  idempotencyKey: string | null;
  checkoutRequestHash: string | null;
  voucherAwardId?: string | null;
  hasQuizVoucherItem?: boolean;
  deliveryMode: StorefrontCheckoutBinding['deliveryMode'];
  checkoutVariant: StorefrontCheckoutVariant;
}): StorefrontCheckoutBinding | null {
  if (!enabled || !sharedCart) return null;
  if (!principalId?.trim()) {
    throw new MerchantRateAttestationInputError(
      'Trusted shared-cart principal is required'
    );
  }
  if (hasQuizVoucherItem) {
    if (
      !voucherAwardId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        voucherAwardId
      )
    ) {
      throw new MerchantRateAttestationInputError(
        'Verified quiz voucher award id is required'
      );
    }
    if (deliveryMode === 'replay') {
      throw new MerchantRateAttestationInputError(
        'Quiz voucher replay binding is unsupported'
      );
    }
    return {
      cartId: sharedCart.cart_id,
      checkoutSessionId: sharedCart.checkout_session_id,
      checkoutGeneration: sharedCart.checkout_generation,
      cartVersion: sharedCart.cart_version,
      principalId,
      deliveryMode,
      identityKind: 'quiz_voucher',
      checkoutVariant: 'quiz_voucher',
      voucherAwardId,
    };
  }
  if (!idempotencyKey?.trim()) {
    throw new MerchantRateAttestationInputError(
      'Checkout idempotency key is required for shared-cart binding'
    );
  }
  if (!checkoutRequestHash || !/^[0-9a-f]{64}$/.test(checkoutRequestHash)) {
    throw new MerchantRateAttestationInputError(
      'Canonical checkout request hash is required for shared-cart binding'
    );
  }
  if (checkoutVariant === 'quiz_voucher') {
    throw new MerchantRateAttestationInputError(
      'Quiz voucher variant requires a verified voucher identity'
    );
  }
  return {
    cartId: sharedCart.cart_id,
    checkoutSessionId: sharedCart.checkout_session_id,
    checkoutGeneration: sharedCart.checkout_generation,
    cartVersion: sharedCart.cart_version,
    idempotencyKey: idempotencyKey.trim(),
    principalId,
    checkoutRequestHash,
    deliveryMode,
    identityKind: 'idempotent',
    checkoutVariant,
  };
}

export class MerchantRateAttestationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MerchantRateAttestationInputError';
  }
}

export function isMerchantRateAttestationEnabled(
  value = process.env[MERCHANT_RATE_ATTESTATION_ENV]
): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function toMinorUnits(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new MerchantRateAttestationInputError(`${field} is invalid`);
  }
  const scaled = value * 100;
  const minor = Math.round(scaled);
  const tolerance = Math.min(
    1e-7 + Number.EPSILON * Math.abs(scaled) * 4,
    0.01
  );
  if (!Number.isSafeInteger(minor) || Math.abs(scaled - minor) > tolerance) {
    throw new MerchantRateAttestationInputError(
      `${field} must be representable as minor units`
    );
  }
  return minor;
}

/**
 * Converts server-verified route economics and trusted cart authority into the
 * signed RPC claim. The default-off flag is a rollout gate only; the database
 * must independently validate the claim before this path is protected.
 */
export function buildMerchantRateAttestation({
  enabled,
  sharedCart,
  shippingRateId,
  shippingConfigRevision,
  canonicalSubtotal,
  shippingFee,
  fulfillmentKind,
  addressCountry,
  addressState,
  merchantCountry,
  isReplay = false,
}: {
  enabled: boolean;
  sharedCart: SharedCartRateBinding | undefined;
  shippingRateId: string | null | undefined;
  shippingConfigRevision: string | undefined;
  canonicalSubtotal: number | null;
  shippingFee: number;
  fulfillmentKind: 'ship' | 'pickup';
  addressCountry: string | null | undefined;
  addressState: string | null | undefined;
  merchantCountry: string | null | undefined;
  isReplay?: boolean;
}): StorefrontMerchantRateAttestation | null {
  if (!enabled || !sharedCart || !shippingRateId || isReplay) return null;

  if (!shippingConfigRevision) {
    throw new MerchantRateAttestationInputError(
      'Shipping configuration revision is unavailable'
    );
  }
  if (canonicalSubtotal === null || !Number.isFinite(canonicalSubtotal)) {
    throw new MerchantRateAttestationInputError(
      'Canonical shipping basis is unavailable'
    );
  }

  const addressCountryCode = (addressCountry ?? '').trim();
  const fallbackCountryCode = (merchantCountry ?? '').trim();
  const destinationCountryCode = /^[A-Za-z]{2}$/.test(addressCountryCode)
    ? addressCountryCode.toUpperCase()
    : fallbackCountryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(destinationCountryCode)) {
    throw new MerchantRateAttestationInputError(
      'Normalized shipping country is unavailable'
    );
  }

  return {
    shippingRateId,
    shippingConfigRevision,
    canonicalSubtotalMinor: toMinorUnits(
      canonicalSubtotal,
      'Canonical shipping basis'
    ),
    destinationCountryCode,
    destinationSubdivisionCode: resolveSubdivisionCode(
      destinationCountryCode,
      addressState ?? null
    ),
    shippingFeeMinor: toMinorUnits(shippingFee, 'Verified shipping fee'),
    fulfillmentKind,
  };
}
