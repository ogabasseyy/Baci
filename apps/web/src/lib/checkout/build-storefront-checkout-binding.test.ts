import { describe, expect, it } from 'vitest';
import { buildStorefrontCheckoutBinding } from './build-storefront-checkout-binding';

const sharedCart = {
  cart_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  checkout_session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  checkout_generation: 2,
  cart_version: 7,
};

const baseInput = {
  enabled: true,
  sharedCart,
  principalId: 'guest:cart-principal-123',
  idempotencyKey: 'checkout-request-123456',
  checkoutRequestHash: 'a'.repeat(64),
  checkoutVariant: 'base' as const,
};

describe('buildStorefrontCheckoutBinding', () => {
  it.each([
    'merchant_rate',
    'replay',
  ] as const)('binds the server identity for %s mode', (deliveryMode) => {
    expect(
      buildStorefrontCheckoutBinding({ ...baseInput, deliveryMode })
    ).toMatchObject({
      cartId: sharedCart.cart_id,
      checkoutSessionId: sharedCart.checkout_session_id,
      checkoutGeneration: 2,
      cartVersion: 7,
      identityKind: 'idempotent',
      deliveryMode,
    });
  });

  it.each([
    ['principal', { principalId: null }],
    ['idempotency key', { idempotencyKey: null }],
    ['request hash', { checkoutRequestHash: null }],
  ])('fails closed when the %s is missing', (_label, overrides) => {
    expect(() =>
      buildStorefrontCheckoutBinding({
        ...baseInput,
        ...overrides,
        deliveryMode: 'merchant_rate',
      })
    ).toThrow();
  });

  it('returns null while disabled or without shared-cart authority', () => {
    expect(
      buildStorefrontCheckoutBinding({
        ...baseInput,
        enabled: false,
        deliveryMode: 'merchant_rate',
      })
    ).toBeNull();
    expect(
      buildStorefrontCheckoutBinding({
        ...baseInput,
        sharedCart: undefined,
        deliveryMode: 'merchant_rate',
      })
    ).toBeNull();
  });

  it('binds quiz vouchers to the verified award without fabricated idempotency data', () => {
    expect(
      buildStorefrontCheckoutBinding({
        ...baseInput,
        idempotencyKey: null,
        checkoutRequestHash: null,
        voucherAwardId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        hasQuizVoucherItem: true,
        checkoutVariant: 'quiz_voucher',
        deliveryMode: 'merchant_rate',
      })
    ).toMatchObject({
      identityKind: 'quiz_voucher',
      voucherAwardId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
  });

  it.each([
    [
      'missing verified award',
      { voucherAwardId: null, deliveryMode: 'no_merchant_rate' as const },
    ],
    [
      'replayed voucher',
      {
        voucherAwardId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        deliveryMode: 'replay' as const,
      },
    ],
  ])('rejects a %s', (_label, overrides) => {
    expect(() =>
      buildStorefrontCheckoutBinding({
        ...baseInput,
        idempotencyKey: null,
        checkoutRequestHash: null,
        hasQuizVoucherItem: true,
        checkoutVariant: 'quiz_voucher',
        ...overrides,
      })
    ).toThrow();
  });
});
