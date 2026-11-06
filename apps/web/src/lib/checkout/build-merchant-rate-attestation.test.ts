import { describe, expect, it } from 'vitest';
import {
  buildMerchantRateAttestation,
  buildSharedCartShippingRateMarker,
  buildStorefrontCheckoutBinding,
  isMerchantRateAttestationEnabled,
} from './build-merchant-rate-attestation';

const validInput = {
  enabled: true,
  sharedCart: {
    cart_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    checkout_session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    checkout_generation: 2,
    cart_version: 7,
  },
  shippingRateId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  shippingConfigRevision: '42',
  canonicalSubtotal: 154.9,
  shippingFee: 12.5,
  fulfillmentKind: 'ship' as const,
  addressCountry: null,
  addressState: 'Lagos',
  merchantCountry: 'ng',
};

describe('buildMerchantRateAttestation', () => {
  it('keeps the feature default-off and preserves voucher/legacy input behavior', () => {
    expect(isMerchantRateAttestationEnabled(undefined)).toBe(false);
    expect(isMerchantRateAttestationEnabled('TRUE')).toBe(true);
    expect(
      buildMerchantRateAttestation({
        ...validInput,
        enabled: false,
        shippingConfigRevision: undefined,
        canonicalSubtotal: null,
      })
    ).toBeNull();
    expect(
      buildMerchantRateAttestation({
        ...validInput,
        sharedCart: undefined,
      })
    ).toBeNull();
  });

  it('builds a normalized signed claim from trusted cart and verified rate values', () => {
    expect(buildMerchantRateAttestation(validInput)).toEqual({
      shippingRateId: validInput.shippingRateId,
      shippingConfigRevision: '42',
      canonicalSubtotalMinor: 15490,
      destinationCountryCode: 'NG',
      destinationSubdivisionCode: 'NG-LA',
      shippingFeeMinor: 1250,
      fulfillmentKind: 'ship',
    });
  });

  it.each([
    [5_000_000.55, 500_000_055],
    [10_000_000.55, 1_000_000_055],
  ])('preserves cents for large valid amounts (%s)', (amount, minorUnits) => {
    expect(
      buildMerchantRateAttestation({
        ...validInput,
        canonicalSubtotal: amount,
      })
    ).toMatchObject({ canonicalSubtotalMinor: minorUnits });
  });

  it('fails closed when the configuration revision is missing', () => {
    expect(() =>
      buildMerchantRateAttestation({
        ...validInput,
        shippingConfigRevision: undefined,
      })
    ).toThrow('Shipping configuration revision is unavailable');
  });

  it('fails closed when the fresh shipping basis is missing', () => {
    expect(() =>
      buildMerchantRateAttestation({ ...validInput, canonicalSubtotal: null })
    ).toThrow('Canonical shipping basis is unavailable');
  });

  it('fails closed when destination country cannot be normalized', () => {
    expect(() =>
      buildMerchantRateAttestation({ ...validInput, merchantCountry: null })
    ).toThrow('Normalized shipping country is unavailable');
  });

  it('rejects non-cent amounts instead of signing rounded caller-visible values', () => {
    expect(() =>
      buildMerchantRateAttestation({ ...validInput, canonicalSubtotal: 1.001 })
    ).toThrow('Canonical shipping basis must be representable as minor units');
  });

  it('rejects fractional cents at large magnitudes and unsafe minor-unit integers', () => {
    expect(() =>
      buildMerchantRateAttestation({
        ...validInput,
        canonicalSubtotal: 10_000_000.551,
      })
    ).toThrow('Canonical shipping basis must be representable as minor units');
    expect(() =>
      buildMerchantRateAttestation({
        ...validInput,
        canonicalSubtotal: Number.MAX_SAFE_INTEGER,
      })
    ).toThrow('Canonical shipping basis must be representable as minor units');
  });

  it('builds a separate shared-cart binding for fresh orders and replay-first retries', () => {
    const sharedCart = validInput.sharedCart;
    const base = {
      enabled: true,
      sharedCart,
      principalId: 'guest:cart-principal-123',
      idempotencyKey: 'checkout-request-123456',
      checkoutRequestHash: 'a'.repeat(64),
      checkoutVariant: 'base' as const,
    };
    expect(
      buildStorefrontCheckoutBinding({ ...base, deliveryMode: 'merchant_rate' })
    ).toMatchObject({
      cartId: sharedCart.cart_id,
      checkoutSessionId: sharedCart.checkout_session_id,
      checkoutGeneration: 2,
      cartVersion: 7,
      deliveryMode: 'merchant_rate',
    });
    expect(
      buildStorefrontCheckoutBinding({ ...base, deliveryMode: 'replay' })
    ).toMatchObject({ deliveryMode: 'replay' });
  });

  it.each([
    ['principal', { principalId: null }],
    ['idempotency key', { idempotencyKey: null }],
    ['request hash', { checkoutRequestHash: null }],
  ])('fails closed when shared-cart %s is missing while enabled', (_label, overrides) => {
    expect(() =>
      buildStorefrontCheckoutBinding({
        enabled: true,
        sharedCart: validInput.sharedCart,
        principalId: 'guest:cart-principal-123',
        idempotencyKey: 'checkout-request-123456',
        checkoutRequestHash: 'a'.repeat(64),
        deliveryMode: 'merchant_rate',
        checkoutVariant: 'base',
        ...overrides,
      })
    ).toThrow();
  });

  it('binds voucher identity to the verified award without ordinary idempotency args', () => {
    expect(
      buildStorefrontCheckoutBinding({
        enabled: true,
        sharedCart: validInput.sharedCart,
        principalId: 'guest:cart-principal-123',
        idempotencyKey: null,
        checkoutRequestHash: null,
        voucherAwardId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        hasQuizVoucherItem: true,
        deliveryMode: 'merchant_rate',
        checkoutVariant: 'quiz_voucher',
      })
    ).toEqual({
      cartId: validInput.sharedCart.cart_id,
      checkoutSessionId: validInput.sharedCart.checkout_session_id,
      checkoutGeneration: 2,
      cartVersion: 7,
      principalId: 'guest:cart-principal-123',
      deliveryMode: 'merchant_rate',
      identityKind: 'quiz_voucher',
      checkoutVariant: 'quiz_voucher',
      voucherAwardId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
  });

  it('fails closed when a flag-on voucher binding has no verified award identity', () => {
    expect(() =>
      buildStorefrontCheckoutBinding({
        enabled: true,
        sharedCart: validInput.sharedCart,
        principalId: 'guest:cart-principal-123',
        idempotencyKey: null,
        checkoutRequestHash: null,
        voucherAwardId: null,
        hasQuizVoucherItem: true,
        deliveryMode: 'no_merchant_rate',
        checkoutVariant: 'quiz_voucher',
      })
    ).toThrow('Verified quiz voucher award id is required');
  });
});

describe('buildSharedCartShippingRateMarker', () => {
  it('adds an explicit nullable marker only to enabled shared-cart binder args', () => {
    expect(
      buildSharedCartShippingRateMarker({
        enabled: true,
        sharedCart: validInput.sharedCart,
        shippingRateId: null,
      })
    ).toEqual({ p_shipping_rate_id: null });
    expect(
      buildSharedCartShippingRateMarker({
        enabled: true,
        sharedCart: validInput.sharedCart,
        shippingRateId: validInput.shippingRateId,
      })
    ).toEqual({ p_shipping_rate_id: validInput.shippingRateId });
    expect(
      buildSharedCartShippingRateMarker({
        enabled: false,
        sharedCart: validInput.sharedCart,
        shippingRateId: validInput.shippingRateId,
      })
    ).toBeNull();
    expect(
      buildSharedCartShippingRateMarker({
        enabled: true,
        sharedCart: undefined,
        shippingRateId: validInput.shippingRateId,
      })
    ).toBeNull();
  });
});
