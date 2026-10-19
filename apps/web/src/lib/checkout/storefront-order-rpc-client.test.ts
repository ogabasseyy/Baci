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

describe('createStorefrontOrderRpcClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signScopedSupabaseJwt.mockReturnValue('signed-order-token');
    mocks.createScopedClient.mockReturnValue(signedClient);
  });

  it('signs a merchant-bound route context while preserving an authenticated user', () => {
    const client = createStorefrontOrderRpcClient({
      fallbackClient,
      hasCanonicalDeliveryMetadata: true,
      merchantId: ' merchant-123 ',
      userId: 'user-456',
      now: new Date('2026-08-28T00:00:00.000Z'),
    });

    expect(client).toBe(signedClient);
    expect(mocks.signScopedSupabaseJwt).toHaveBeenCalledWith({
      aud: 'authenticated',
      exp: 1_787_875_500,
      iat: 1_787_875_200,
      role: 'authenticated',
      storefront_order_context: 'route',
      storefront_order_hash_version: 2,
      storefront_order_merchant_id: 'merchant-123',
      sub: 'user-456',
    });
    expect(mocks.createScopedClient).toHaveBeenCalledWith('signed-order-token');
  });

  it('omits sub for guest checkout so the database keeps it anonymous', () => {
    createStorefrontOrderRpcClient({
      fallbackClient,
      hasCanonicalDeliveryMetadata: true,
      merchantId: 'merchant-123',
      userId: null,
      now: new Date('2026-08-28T00:00:00.000Z'),
    });

    expect(mocks.signScopedSupabaseJwt).toHaveBeenCalledWith({
      aud: 'authenticated',
      exp: 1_787_875_500,
      iat: 1_787_875_200,
      role: 'authenticated',
      storefront_order_context: 'route',
      storefront_order_hash_version: 2,
      storefront_order_merchant_id: 'merchant-123',
    });
  });

  it('binds the normalized REDVAULT guest email in the signed claim', () => {
    createStorefrontOrderRpcClient({
      fallbackClient,
      hasCanonicalDeliveryMetadata: false,
      merchantId: 'merchant-123',
      userId: null,
      redvaultCustomerEmail: ' Customer@Example.test ',
    });
    expect(mocks.signScopedSupabaseJwt).toHaveBeenCalledWith(
      expect.objectContaining({
        storefront_redvault_customer_email: 'customer@example.test',
      })
    );
  });

  it('omits a whitespace-only REDVAULT customer claim', () => {
    createStorefrontOrderRpcClient({
      fallbackClient,
      hasCanonicalDeliveryMetadata: false,
      merchantId: 'merchant-123',
      userId: null,
      redvaultCustomerEmail: '   ',
    });

    expect(mocks.signScopedSupabaseJwt).toHaveBeenCalledOnce();
    expect(mocks.signScopedSupabaseJwt.mock.calls[0][0]).not.toHaveProperty(
      'storefront_redvault_customer_email'
    );
  });

  it('does not claim a v2 hash for legacy requests without delivery metadata', () => {
    createStorefrontOrderRpcClient({
      fallbackClient,
      hasCanonicalDeliveryMetadata: false,
      merchantId: 'merchant-123',
      userId: null,
      now: new Date('2026-08-28T00:00:00.000Z'),
    });

    expect(mocks.signScopedSupabaseJwt).toHaveBeenCalledWith({
      aud: 'authenticated',
      exp: 1_787_875_500,
      iat: 1_787_875_200,
      role: 'authenticated',
      storefront_order_context: 'route',
      storefront_order_merchant_id: 'merchant-123',
    });
  });

  it('uses the injected mock only in tests when signing material is unavailable', () => {
    mocks.signScopedSupabaseJwt.mockImplementation(() => {
      throw new Error('missing signing material');
    });

    expect(
      createStorefrontOrderRpcClient({
        fallbackClient,
        hasCanonicalDeliveryMetadata: true,
        merchantId: 'merchant-123',
        userId: null,
      })
    ).toBe(fallbackClient);
  });
});
