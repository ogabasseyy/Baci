import { describe, expect, it } from 'vitest';
import type {
  StorefrontCheckoutBinding,
  StorefrontMerchantRateAttestation,
} from './storefront-order-claim-types';
import { validateCheckoutBinding } from './validate-checkout-binding';
import { validateMerchantRateAttestation } from './validate-merchant-rate-attestation';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const SHIPPING_RATE_ID = '22222222-2222-4222-8222-222222222222';
const validCheckoutBinding: StorefrontCheckoutBinding = {
  cartId: '33333333-3333-4333-8333-333333333333',
  checkoutSessionId: '44444444-4444-4444-8444-444444444444',
  checkoutGeneration: 4,
  cartVersion: 8,
  identityKind: 'idempotent',
  checkoutVariant: 'base',
  idempotencyKey: 'checkout-idempotency-0001',
  principalId: 'shared-cart-principal-opaque',
  checkoutRequestHash: 'a'.repeat(64),
  deliveryMode: 'merchant_rate',
};
const validAttestation: StorefrontMerchantRateAttestation = {
  shippingRateId: SHIPPING_RATE_ID,
  shippingConfigRevision: '9223372036854775807',
  canonicalSubtotalMinor: 123_456,
  destinationCountryCode: 'NG',
  destinationSubdivisionCode: 'NG-LA',
  shippingFeeMinor: 2_500,
  fulfillmentKind: 'ship',
};

describe('validateMerchantRateAttestation', () => {
  const checkoutBinding = validateCheckoutBinding(validCheckoutBinding);

  it('normalizes merchant and shipping rate UUIDs and preserves verified economics', () => {
    expect(
      validateMerchantRateAttestation({
        merchantId: ` ${MERCHANT_ID.toUpperCase()} `,
        attestation: {
          ...validAttestation,
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
          ...validAttestation,
          ...overrides,
        } as unknown as StorefrontMerchantRateAttestation,
        checkoutBinding,
        hasCanonicalDeliveryMetadata: true,
      })
    ).toThrow();
  });

  it('rejects an invalid merchant UUID', () => {
    expect(() =>
      validateMerchantRateAttestation({
        merchantId: 'merchant-1',
        attestation: validAttestation,
        checkoutBinding,
        hasCanonicalDeliveryMetadata: true,
      })
    ).toThrow(/UUID merchant id/);
  });

  it('rejects missing delivery metadata and non-merchant-rate mode', () => {
    expect(() =>
      validateMerchantRateAttestation({
        merchantId: MERCHANT_ID,
        attestation: validAttestation,
        checkoutBinding,
        hasCanonicalDeliveryMetadata: false,
      })
    ).toThrow(/canonical delivery metadata/);
    expect(() =>
      validateMerchantRateAttestation({
        merchantId: MERCHANT_ID,
        attestation: validAttestation,
        checkoutBinding: validateCheckoutBinding({
          ...validCheckoutBinding,
          deliveryMode: 'replay',
        }),
        hasCanonicalDeliveryMetadata: true,
      })
    ).toThrow(/merchant_rate checkout mode/);
  });
});
