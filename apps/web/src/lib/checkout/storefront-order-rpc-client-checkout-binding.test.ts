import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createScopedClient: vi.fn(),
  signScopedSupabaseJwt: vi.fn(),
}));

vi.mock('@/lib/supabase/scoped', () => ({
  createScopedClient: mocks.createScopedClient,
}));
vi.mock('@/lib/supabase/scoped-jwt', () => ({
  signScopedSupabaseJwt: mocks.signScopedSupabaseJwt,
}));

import {
  createStorefrontOrderRpcClient,
  type StorefrontCheckoutBinding,
} from './storefront-order-rpc-client';

const fallbackClient = {} as SupabaseClient;
const signedClient = {} as SupabaseClient;
const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const SHIPPING_RATE_ID = '22222222-2222-4222-8222-222222222222';
const CART_ID = '33333333-3333-4333-8333-333333333333';
const CHECKOUT_SESSION_ID = '44444444-4444-4444-8444-444444444444';

const validMerchantRateAttestation = {
  shippingRateId: SHIPPING_RATE_ID,
  shippingConfigRevision: '9223372036854775807',
  canonicalSubtotalMinor: 123_456,
  destinationCountryCode: 'NG',
  destinationSubdivisionCode: 'NG-LA',
  shippingFeeMinor: 2_500,
  fulfillmentKind: 'ship' as const,
};
const validCheckoutBinding = {
  cartId: CART_ID,
  checkoutSessionId: CHECKOUT_SESSION_ID,
  checkoutGeneration: 4,
  cartVersion: 8,
  identityKind: 'idempotent' as const,
  checkoutVariant: 'base' as const,
  idempotencyKey: 'checkout-idempotency-0001',
  principalId: 'shared-cart-principal-opaque',
  checkoutRequestHash: 'a'.repeat(64),
  deliveryMode: 'merchant_rate' as const,
};

describe('createStorefrontOrderRpcClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signScopedSupabaseJwt.mockReturnValue('signed-order-token');
    mocks.createScopedClient.mockReturnValue(signedClient);
  });

  it('normalizes opaque cart/session UUIDs but preserves exact idempotency and principal values', () => {
    createStorefrontOrderRpcClient({
      fallbackClient,
      hasCanonicalDeliveryMetadata: true,
      merchantId: MERCHANT_ID,
      userId: null,
      merchantRateAttestation: validMerchantRateAttestation,
      checkoutBinding: {
        ...validCheckoutBinding,
        cartId: CART_ID.toUpperCase(),
        checkoutSessionId: CHECKOUT_SESSION_ID.toUpperCase(),
      },
    });

    expect(mocks.signScopedSupabaseJwt.mock.calls[0][0]).toMatchObject({
      storefront_checkout_binding: {
        cart_id: CART_ID,
        checkout_session_id: CHECKOUT_SESSION_ID,
        idempotency_key: 'checkout-idempotency-0001',
        principal_id: 'shared-cart-principal-opaque',
        checkout_request_hash: 'a'.repeat(64),
      },
    });
  });

  it.each([
    ['malformed cart id', { cartId: 'cart-1' }],
    ['malformed checkout session id', { checkoutSessionId: 'session-1' }],
    ['zero checkout generation', { checkoutGeneration: 0 }],
    ['fractional checkout generation', { checkoutGeneration: 1.5 }],
    [
      'unsafe checkout generation',
      { checkoutGeneration: Number.MAX_SAFE_INTEGER + 1 },
    ],
    ['overflow checkout generation', { checkoutGeneration: 2_147_483_648 }],
    ['zero cart version', { cartVersion: 0 }],
    ['fractional cart version', { cartVersion: 1.5 }],
    ['overflow cart version', { cartVersion: 2_147_483_648 }],
    ['short idempotency key', { idempotencyKey: 'too-short' }],
    [
      'whitespace-padded idempotency key',
      { idempotencyKey: ' checkout-idempotency-0001 ' },
    ],
    ['oversized idempotency key', { idempotencyKey: 'x'.repeat(129) }],
    ['blank principal id', { principalId: '   ' }],
    ['oversized principal id', { principalId: 'x'.repeat(129) }],
    ['malformed request hash', { checkoutRequestHash: 'a'.repeat(63) }],
    ['uppercase request hash', { checkoutRequestHash: 'A'.repeat(64) }],
    ['unsupported order variant', { checkoutVariant: 'invalid' }],
    [
      'voucher variant on ordinary identity',
      { checkoutVariant: 'quiz_voucher' },
    ],
  ])('rejects %s before signing', (_case, overrides) => {
    expect(() =>
      createStorefrontOrderRpcClient({
        fallbackClient,
        hasCanonicalDeliveryMetadata: true,
        merchantId: MERCHANT_ID,
        userId: null,
        checkoutBinding: {
          ...validCheckoutBinding,
          ...overrides,
        } as unknown as StorefrontCheckoutBinding,
      })
    ).toThrow(/Checkout binding/);
    expect(mocks.signScopedSupabaseJwt).not.toHaveBeenCalled();
  });
  it('requires a rate attestation for fresh merchant-rate mode', () => {
    expect(() =>
      createStorefrontOrderRpcClient({
        fallbackClient,
        hasCanonicalDeliveryMetadata: true,
        merchantId: MERCHANT_ID,
        userId: null,
        checkoutBinding: validCheckoutBinding,
      })
    ).toThrow(/requires a rate attestation/);
    expect(mocks.signScopedSupabaseJwt).not.toHaveBeenCalled();
  });

  it.each([
    'no_merchant_rate',
    'replay',
  ] as const)('signs checkout binding mode %s without asserting a fresh rate', (deliveryMode) => {
    createStorefrontOrderRpcClient({
      fallbackClient,
      hasCanonicalDeliveryMetadata: true,
      merchantId: MERCHANT_ID,
      userId: null,
      checkoutBinding: { ...validCheckoutBinding, deliveryMode },
    });
    expect(mocks.signScopedSupabaseJwt.mock.calls[0][0]).toMatchObject({
      storefront_checkout_binding: { delivery_mode: deliveryMode },
    });
    expect(mocks.signScopedSupabaseJwt.mock.calls[0][0]).not.toHaveProperty(
      'storefront_merchant_rate_attestation'
    );
  });

  it.each([
    'no_merchant_rate',
    'replay',
  ] as const)('rejects a fresh merchant-rate claim under %s mode', (deliveryMode) => {
    expect(() =>
      createStorefrontOrderRpcClient({
        fallbackClient,
        hasCanonicalDeliveryMetadata: true,
        merchantId: MERCHANT_ID,
        userId: null,
        checkoutBinding: { ...validCheckoutBinding, deliveryMode },
        merchantRateAttestation: validMerchantRateAttestation,
      })
    ).toThrow(/requires merchant_rate checkout mode/);
    expect(mocks.signScopedSupabaseJwt).not.toHaveBeenCalled();
  });

  it.each([
    'merchant_rate',
    'no_merchant_rate',
  ] as const)('signs a quiz voucher identity independently of %s delivery without a fabricated key or hash', (deliveryMode) => {
    createStorefrontOrderRpcClient({
      fallbackClient,
      hasCanonicalDeliveryMetadata: true,
      merchantId: MERCHANT_ID,
      userId: null,
      checkoutBinding: {
        cartId: CART_ID,
        checkoutSessionId: CHECKOUT_SESSION_ID,
        checkoutGeneration: 4,
        cartVersion: 8,
        principalId: 'shared-cart-principal-opaque',
        identityKind: 'quiz_voucher',
        checkoutVariant: 'quiz_voucher',
        voucherAwardId: '55555555-5555-4555-8555-555555555555',
        deliveryMode,
      },
      ...(deliveryMode === 'merchant_rate'
        ? { merchantRateAttestation: validMerchantRateAttestation }
        : {}),
    });

    const claims = mocks.signScopedSupabaseJwt.mock.calls[0][0];
    expect(claims).toMatchObject({
      storefront_checkout_binding: {
        identity_kind: 'quiz_voucher',
        checkout_variant: 'quiz_voucher',
        voucher_award_id: '55555555-5555-4555-8555-555555555555',
        delivery_mode: deliveryMode,
      },
    });
    expect(claims.storefront_checkout_binding).not.toHaveProperty(
      'idempotency_key'
    );
    expect(claims.storefront_checkout_binding).not.toHaveProperty(
      'checkout_request_hash'
    );
  });

  it.each([
    ['invalid voucher award id', { voucherAwardId: 'award-1' }],
    ['invalid voucher variant', { checkoutVariant: 'other' }],
  ])('rejects %s before signing', (_name, overrides) => {
    expect(() =>
      createStorefrontOrderRpcClient({
        fallbackClient,
        hasCanonicalDeliveryMetadata: true,
        merchantId: MERCHANT_ID,
        userId: null,
        checkoutBinding: {
          cartId: CART_ID,
          checkoutSessionId: CHECKOUT_SESSION_ID,
          checkoutGeneration: 4,
          cartVersion: 8,
          principalId: 'shared-cart-principal-opaque',
          identityKind: 'quiz_voucher',
          checkoutVariant: 'quiz_voucher',
          voucherAwardId: '55555555-5555-4555-8555-555555555555',
          deliveryMode: 'no_merchant_rate',
          ...overrides,
        } as unknown as StorefrontCheckoutBinding,
      })
    ).toThrow(/Checkout binding variant|Voucher checkout binding/);
    expect(mocks.signScopedSupabaseJwt).not.toHaveBeenCalled();
  });

  it.each([
    'base',
    'savings',
    'discount_code',
    'loyalty_code',
    'redvault',
  ] as const)('signs the allowed idempotent order variant %s', (checkoutVariant) => {
    createStorefrontOrderRpcClient({
      fallbackClient,
      hasCanonicalDeliveryMetadata: true,
      merchantId: MERCHANT_ID,
      userId: null,
      checkoutBinding: {
        ...validCheckoutBinding,
        checkoutVariant,
        deliveryMode: 'no_merchant_rate',
      },
    });

    expect(mocks.signScopedSupabaseJwt.mock.calls[0][0]).toMatchObject({
      storefront_checkout_binding: {
        identity_kind: 'idempotent',
        checkout_variant: checkoutVariant,
      },
    });
  });

  it('rejects quiz_voucher order variant on idempotent identity', () => {
    expect(() =>
      createStorefrontOrderRpcClient({
        fallbackClient,
        hasCanonicalDeliveryMetadata: true,
        merchantId: MERCHANT_ID,
        userId: null,
        checkoutBinding: {
          ...validCheckoutBinding,
          checkoutVariant: 'quiz_voucher',
        } as unknown as StorefrontCheckoutBinding,
      })
    ).toThrow(/Checkout binding variant/);
    expect(mocks.signScopedSupabaseJwt).not.toHaveBeenCalled();
  });
});
