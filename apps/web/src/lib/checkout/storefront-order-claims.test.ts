import { describe, expect, it } from 'vitest';
import {
  type StorefrontCheckoutBinding,
  type StorefrontMerchantRateAttestation,
  validateCheckoutBinding,
  validateMerchantRateAttestation,
} from './storefront-order-claims';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const SHIPPING_RATE_ID = '22222222-2222-4222-8222-222222222222';
const CART_ID = '33333333-3333-4333-8333-333333333333';
const CHECKOUT_SESSION_ID = '44444444-4444-4444-8444-444444444444';

const validCheckoutBinding: StorefrontCheckoutBinding = {
  cartId: CART_ID,
  checkoutSessionId: CHECKOUT_SESSION_ID,
  checkoutGeneration: 4,
  cartVersion: 8,
  identityKind: 'idempotent',
  checkoutVariant: 'base',
  idempotencyKey: 'checkout-idempotency-0001',
  principalId: 'shared-cart-principal-opaque',
  checkoutRequestHash: 'a'.repeat(64),
  deliveryMode: 'merchant_rate',
};

const validMerchantRateAttestation: StorefrontMerchantRateAttestation = {
  shippingRateId: SHIPPING_RATE_ID,
  shippingConfigRevision: '9223372036854775807',
  canonicalSubtotalMinor: 123_456,
  destinationCountryCode: 'NG',
  destinationSubdivisionCode: 'NG-LA',
  shippingFeeMinor: 2_500,
  fulfillmentKind: 'ship',
};

describe('validateCheckoutBinding', () => {
  it('normalizes UUID fields while preserving opaque identity fields', () => {
    expect(
      validateCheckoutBinding({
        ...validCheckoutBinding,
        cartId: CART_ID.toUpperCase(),
        checkoutSessionId: CHECKOUT_SESSION_ID.toUpperCase(),
      })
    ).toEqual({
      version: 1,
      cart_id: CART_ID,
      checkout_session_id: CHECKOUT_SESSION_ID,
      checkout_generation: 4,
      cart_version: 8,
      principal_id: 'shared-cart-principal-opaque',
      delivery_mode: 'merchant_rate',
      identity_kind: 'idempotent',
      checkout_variant: 'base',
      idempotency_key: 'checkout-idempotency-0001',
      checkout_request_hash: 'a'.repeat(64),
    });
  });

  it.each([
    ['invalid cart UUID', { cartId: 'cart-1' }],
    ['invalid session UUID', { checkoutSessionId: 'session-1' }],
    ['zero generation', { checkoutGeneration: 0 }],
    ['fractional cart version', { cartVersion: 1.5 }],
    ['blank principal', { principalId: '  ' }],
    ['short idempotency key', { idempotencyKey: 'too-short' }],
    ['invalid request hash', { checkoutRequestHash: 'a'.repeat(63) }],
    [
      'quiz voucher variant for idempotent identity',
      { checkoutVariant: 'quiz_voucher' },
    ],
  ])('rejects %s', (_case, overrides) => {
    expect(() =>
      validateCheckoutBinding({
        ...validCheckoutBinding,
        ...overrides,
      } as StorefrontCheckoutBinding)
    ).toThrow();
  });
});

describe('validateMerchantRateAttestation', () => {
  const checkoutBinding = validateCheckoutBinding(validCheckoutBinding);

  it('normalizes merchant and shipping rate UUIDs and preserves verified economics', () => {
    expect(
      validateMerchantRateAttestation({
        merchantId: ` ${MERCHANT_ID.toUpperCase()} `,
        attestation: {
          ...validMerchantRateAttestation,
          shippingRateId: SHIPPING_RATE_ID.toUpperCase(),
        },
        checkoutBinding,
        hasCanonicalDeliveryMetadata: true,
      })
    ).toEqual({
      version: 1,
      merchant_id: MERCHANT_ID,
      shipping_rate_id: SHIPPING_RATE_ID,
      shipping_config_revision: '9223372036854775807',
      canonical_subtotal_minor: 123_456,
      destination_country_code: 'NG',
      destination_subdivision_code: 'NG-LA',
      shipping_fee_minor: 2_500,
      fulfillment_kind: 'ship',
    });
  });

  it.each([
    ['invalid shipping rate UUID', { shippingRateId: 'rate-1' }],
    ['overflowing revision', { shippingConfigRevision: '9223372036854775808' }],
    ['fractional subtotal', { canonicalSubtotalMinor: 1.5 }],
    ['unsafe shipping fee', { shippingFeeMinor: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-ISO country code', { destinationCountryCode: 'nga' }],
    [
      'subdivision from a different country',
      { destinationSubdivisionCode: 'US-CA' },
    ],
    ['invalid fulfillment kind', { fulfillmentKind: 'courier' }],
  ])('rejects %s', (_case, overrides) => {
    expect(() =>
      validateMerchantRateAttestation({
        merchantId: MERCHANT_ID,
        attestation: {
          ...validMerchantRateAttestation,
          ...overrides,
        } as StorefrontMerchantRateAttestation,
        checkoutBinding,
        hasCanonicalDeliveryMetadata: true,
      })
    ).toThrow();
  });

  it('rejects an invalid merchant UUID', () => {
    expect(() =>
      validateMerchantRateAttestation({
        merchantId: 'merchant-1',
        attestation: validMerchantRateAttestation,
        checkoutBinding,
        hasCanonicalDeliveryMetadata: true,
      })
    ).toThrow(/UUID merchant id/);
  });

  it('rejects missing canonical delivery metadata and non-merchant-rate mode', () => {
    expect(() =>
      validateMerchantRateAttestation({
        merchantId: MERCHANT_ID,
        attestation: validMerchantRateAttestation,
        checkoutBinding,
        hasCanonicalDeliveryMetadata: false,
      })
    ).toThrow(/canonical delivery metadata/);

    expect(() =>
      validateMerchantRateAttestation({
        merchantId: MERCHANT_ID,
        attestation: validMerchantRateAttestation,
        checkoutBinding: validateCheckoutBinding({
          ...validCheckoutBinding,
          deliveryMode: 'replay',
        }),
        hasCanonicalDeliveryMetadata: true,
      })
    ).toThrow(/merchant_rate checkout mode/);
  });
});
