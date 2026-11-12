import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const productQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
  };
  productQuery.select.mockImplementation(() => productQuery);
  productQuery.eq.mockImplementation(() => productQuery);
  productQuery.in.mockImplementation(() =>
    Promise.resolve({
      data: [{ id: 'product-1', name: 'Server catalog name' }],
      error: null,
    })
  );
  return {
    ChatwootCommerceContextError: class ChatwootCommerceContextError extends Error {
      constructor(readonly code: string) {
        super(code);
      }
    },
    productQuery,
    createAnonClient: vi.fn(() => ({
      rpc: vi.fn(),
      from: vi.fn(() => productQuery),
    })),
    createAnonMerchantFeatureLookup: vi.fn(() => vi.fn()),
    createCartScopedClient: vi.fn(() => ({ cart: 'scoped' })),
    getCart: vi.fn(),
    getCartProofEnvironment: vi.fn(() => 'test'),
    getChatwootTenantBinding: vi.fn(),
    getCurrentSlugForAlias: vi.fn(),
    requestUsesDeviceProof: vi.fn(() => false),
    resolveCartRequestContext: vi.fn(),
    verifyCartSessionProof: vi.fn(),
    hashCartSessionProof: vi.fn(() => 'a'.repeat(64)),
  };
});

vi.mock('@/lib/cart/merchant-resolution', () => ({
  createAnonMerchantFeatureLookup: mocks.createAnonMerchantFeatureLookup,
}));
vi.mock('@/lib/cart/scoped-client', () => ({
  createCartScopedClient: mocks.createCartScopedClient,
}));
vi.mock('@/lib/cart/request-context', () => ({
  requestUsesDeviceProof: mocks.requestUsesDeviceProof,
  resolveCartRequestContext: mocks.resolveCartRequestContext,
}));
vi.mock('@/lib/cart/cart-runtime-env', () => ({
  getCartProofEnvironment: mocks.getCartProofEnvironment,
}));
vi.mock('@/lib/cart/service', () => ({ getCart: mocks.getCart }));
vi.mock('@/lib/cart/session-proof', () => ({
  verifyCartSessionProof: mocks.verifyCartSessionProof,
}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: mocks.createAnonClient,
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: mocks.getCurrentSlugForAlias,
}));
vi.mock('./commerce-context', () => ({
  ChatwootCommerceContextError: mocks.ChatwootCommerceContextError,
  getChatwootTenantBinding: mocks.getChatwootTenantBinding,
  hashCartSessionProof: mocks.hashCartSessionProof,
  normalizeHttpsOrigin: (origin: string | null) => origin,
}));

import { NextRequest } from 'next/server';
import { loadChatwootCartContext } from './cart-context';

const merchantId = '6df442af-4d21-4f4f-9f0b-607400000001';
const cartId = '6df442af-4d21-4f4f-9f0b-607400000002';
const binding = {
  merchantId,
  origin: 'https://shop.example.com',
  websiteToken: 'synthetic-widget-token-123456',
  inboxId: 74,
};

function prepareVerifiedCart() {
  mocks.resolveCartRequestContext.mockImplementation(async (_request, deps) => {
    await deps.verify('verified-session-proof');
    return {
      ok: true,
      merchant: { id: merchantId, slug: 'shop' },
      principal: {
        cartId,
        grantId: '6df442af-4d21-4f4f-9f0b-607400000003',
        merchantId,
        principalId: '6df442af-4d21-4f4f-9f0b-607400000004',
        scope: 'session',
        expiresAt: '2026-11-08T12:00:00.000Z',
      },
    };
  });
  mocks.getChatwootTenantBinding.mockReturnValue(binding);
  mocks.getCart.mockResolvedValue({
    ok: true,
    cart: {
      cartId,
      merchantId,
      version: 12,
      lines: [
        {
          id: 'server-line',
          item: { productId: 'product-1' },
          quantity: 1,
          unitPriceMinor: 500,
          lineTotalMinor: 500,
        },
      ],
      currency: 'NGN',
      subtotalMinor: 500,
    },
  });
}

function request() {
  return new NextRequest(
    `${binding.origin}/api/storefront/chatwoot/context/authorize`,
    { headers: { host: 'shop.example.com', origin: binding.origin } }
  );
}

describe('Chatwoot cart product-name projection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('queries names under the independently resolved merchant for referenced products', async () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    prepareVerifiedCart();
    const result = await loadChatwootCartContext(request(), {
      includeProductNames: true,
    });

    expect(result).toMatchObject({
      ok: true,
      productNames: { 'product-1': 'Server catalog name' },
    });
    expect(mocks.productQuery.select).toHaveBeenCalledWith('id, name');
    expect(mocks.productQuery.eq).toHaveBeenCalledWith(
      'merchant_id',
      merchantId
    );
    expect(mocks.productQuery.eq).not.toHaveBeenCalledWith('status', 'active');
    expect(mocks.productQuery.in).toHaveBeenCalledWith('id', ['product-1']);
  });

  it('does not query products by default', async () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    prepareVerifiedCart();

    await expect(loadChatwootCartContext(request())).resolves.toMatchObject({
      ok: true,
    });

    expect(mocks.productQuery.select).not.toHaveBeenCalled();
    expect(mocks.productQuery.in).not.toHaveBeenCalled();
  });

  it('keeps the canonical name of an inactive cart product available', async () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    prepareVerifiedCart();
    mocks.productQuery.in.mockResolvedValue({
      data: [
        {
          id: 'product-1',
          name: 'Previously available product',
          status: 'inactive',
        },
      ],
      error: null,
    });

    await expect(
      loadChatwootCartContext(request(), { includeProductNames: true })
    ).resolves.toMatchObject({
      ok: true,
      productNames: { 'product-1': 'Previously available product' },
    });
  });

  it.each([
    ['query error', { data: null, error: new Error('query failed') }],
    ['null data', { data: null, error: null }],
  ])('fails closed on a product-name lookup %s', async (_label, result) => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    prepareVerifiedCart();
    mocks.productQuery.in.mockResolvedValue(result);

    await expect(
      loadChatwootCartContext(request(), { includeProductNames: true })
    ).resolves.toMatchObject({
      ok: false,
      status: 503,
      code: 'temporarily_unavailable',
    });
  });

  it('trims and truncates server product names to 120 characters', async () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    prepareVerifiedCart();
    mocks.productQuery.in.mockResolvedValue({
      data: [{ id: 'product-1', name: `  ${'P'.repeat(140)}  ` }],
      error: null,
    });

    await expect(
      loadChatwootCartContext(request(), { includeProductNames: true })
    ).resolves.toMatchObject({
      ok: true,
      productNames: { 'product-1': 'P'.repeat(120) },
    });
  });
});
