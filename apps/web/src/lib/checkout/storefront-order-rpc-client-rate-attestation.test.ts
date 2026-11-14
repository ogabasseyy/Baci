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

import { createStorefrontOrderRpcClient } from './storefront-order-rpc-client';

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

  it('adds a validated, normalized, merchant-bound rate attestation only when supplied', () => {
    createStorefrontOrderRpcClient({
      fallbackClient,
      hasCanonicalDeliveryMetadata: true,
      merchantId: ` ${MERCHANT_ID.toUpperCase()} `,
      userId: null,
      merchantRateAttestation: validMerchantRateAttestation,
      checkoutBinding: validCheckoutBinding,
    });

    expect(mocks.signScopedSupabaseJwt).toHaveBeenCalledWith(
      expect.objectContaining({
        storefront_order_merchant_id: MERCHANT_ID,
        storefront_merchant_rate_attestation: {
          version: 1,
          merchant_id: MERCHANT_ID,
          shipping_rate_id: SHIPPING_RATE_ID,
          shipping_config_revision: '9223372036854775807',
          canonical_subtotal_minor: 123_456,
          destination_country_code: 'NG',
          destination_subdivision_code: 'NG-LA',
          shipping_fee_minor: 2_500,
          fulfillment_kind: 'ship',
        },
        storefront_checkout_binding: {
          version: 1,
          cart_id: CART_ID,
          checkout_session_id: CHECKOUT_SESSION_ID,
          checkout_generation: 4,
          cart_version: 8,
          idempotency_key: 'checkout-idempotency-0001',
          principal_id: 'shared-cart-principal-opaque',
          checkout_request_hash: 'a'.repeat(64),
          delivery_mode: 'merchant_rate',
          identity_kind: 'idempotent',
          checkout_variant: 'base',
        },
      })
    );
  });
  it.each([
    '0',
    '01',
    '1.5',
    '-1',
    ' 2',
    '9223372036854775808',
  ])('rejects non-canonical revision strings (%s) before signing', (shippingConfigRevision) => {
    expect(() =>
      createStorefrontOrderRpcClient({
        fallbackClient,
        hasCanonicalDeliveryMetadata: true,
        merchantId: MERCHANT_ID,
        userId: null,
        merchantRateAttestation: {
          ...validMerchantRateAttestation,
          shippingConfigRevision,
        },
        checkoutBinding: validCheckoutBinding,
      })
    ).toThrow(/decimal revision string/);
    expect(mocks.signScopedSupabaseJwt).not.toHaveBeenCalled();
  });

  it.each([
    ['fractional subtotal', { canonicalSubtotalMinor: 1.25 }],
    [
      'unsafe subtotal',
      { canonicalSubtotalMinor: Number.MAX_SAFE_INTEGER + 1 },
    ],
    ['negative subtotal', { canonicalSubtotalMinor: -1 }],
    ['fractional fee', { shippingFeeMinor: 10.5 }],
    ['unsafe fee', { shippingFeeMinor: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative fee', { shippingFeeMinor: -1 }],
  ])('rejects %s outside exact minor units', (_case, overrides) => {
    expect(() =>
      createStorefrontOrderRpcClient({
        fallbackClient,
        hasCanonicalDeliveryMetadata: true,
        merchantId: MERCHANT_ID,
        userId: null,
        merchantRateAttestation: {
          ...validMerchantRateAttestation,
          ...overrides,
        },
        checkoutBinding: validCheckoutBinding,
      })
    ).toThrow(/safe integer minor units/);
    expect(mocks.signScopedSupabaseJwt).not.toHaveBeenCalled();
  });

  it.each([
    [
      'un-normalized country',
      { destinationCountryCode: 'ng', destinationSubdivisionCode: null },
    ],
    [
      'country/subdivision mismatch',
      { destinationCountryCode: 'GH', destinationSubdivisionCode: 'NG-LA' },
    ],
    ['malformed subdivision', { destinationSubdivisionCode: 'NG-LAGOS' }],
    ['malformed rate id', { shippingRateId: 'rate-1' }],
  ])('rejects %s in the attestation', (_case, overrides) => {
    expect(() =>
      createStorefrontOrderRpcClient({
        fallbackClient,
        hasCanonicalDeliveryMetadata: true,
        merchantId: MERCHANT_ID,
        userId: null,
        merchantRateAttestation: {
          ...validMerchantRateAttestation,
          ...overrides,
        },
        checkoutBinding: validCheckoutBinding,
      })
    ).toThrow();
    expect(mocks.signScopedSupabaseJwt).not.toHaveBeenCalled();
  });

  it('rejects an attestation without canonical delivery metadata', () => {
    expect(() =>
      createStorefrontOrderRpcClient({
        fallbackClient,
        hasCanonicalDeliveryMetadata: false,
        merchantId: MERCHANT_ID,
        userId: null,
        merchantRateAttestation: validMerchantRateAttestation,
        checkoutBinding: validCheckoutBinding,
      })
    ).toThrow(/canonical delivery metadata/);
    expect(mocks.signScopedSupabaseJwt).not.toHaveBeenCalled();
  });
});
