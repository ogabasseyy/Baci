import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ChatwootCommerceContextError: class ChatwootCommerceContextError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  checkCartQuota: vi.fn(async () => ({ allowed: true })),
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
  lookupMerchantCurrency: vi.fn(async () => ({
    data: { country: 'NG', payout_currency: 'NGN' },
    error: null,
  })),
  createAnonClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mocks.lookupMerchantCurrency })),
      })),
    })),
    rpc: vi.fn(),
  })),
  loadChatwootCartContext: vi.fn(),
  readCartJsonBody: vi.fn(),
  readStorefrontPdpCoreSnapshot: vi.fn(),
  verifyChatwootSessionCapability: vi.fn(),
}));

vi.mock('@/lib/cart/request-context', () => ({
  readCartJsonBody: mocks.readCartJsonBody,
}));
vi.mock('@/lib/cart/request-quota', () => ({
  checkCartQuota: mocks.checkCartQuota,
}));
vi.mock('@/lib/chatwoot/cart-context', () => ({
  loadChatwootCartContext: mocks.loadChatwootCartContext,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  ChatwootCommerceContextError: mocks.ChatwootCommerceContextError,
  verifyChatwootSessionCapability: mocks.verifyChatwootSessionCapability,
}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: mocks.createAnonClient,
}));
vi.mock('@/lib/storefront-pdp-core-snapshot', () => ({
  readStorefrontPdpCoreSnapshot: mocks.readStorefrontPdpCoreSnapshot,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));

import { POST } from './route';

const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const state = {
  cartId,
  cartSessionSha256: 'a'.repeat(64),
  cartVersion: 2,
  grantId: '33333333-3333-4333-8333-333333333333',
  inboxId: 74,
  merchantId,
  origin: 'https://shop.example.com',
  principalId: 'buyer-1',
  websiteToken: 'synthetic-widget-token-123456',
};
const binding = {
  ...state,
};
const body = {
  conversationId: 905,
  requestId: 'product-lookup-1',
  sessionToken: 'signed-session-token',
  slug: 'phone-15',
};

function request() {
  return new NextRequest(
    'https://shop.example.com/api/storefront/chatwoot/products',
    {
      method: 'POST',
      headers: { host: 'shop.example.com', origin: 'https://shop.example.com' },
    }
  );
}

function arrange(input: unknown = body, conversationId = 905) {
  mocks.readCartJsonBody.mockResolvedValue({ ok: true, body: input });
  mocks.loadChatwootCartContext.mockResolvedValue({
    ok: true,
    binding,
    cart: { cartId, merchantId, version: 2, lines: [] },
    principal: { cartId, merchantId, principalId: 'buyer-1' },
    state,
  });
  mocks.verifyChatwootSessionCapability.mockResolvedValue({ conversationId });
  mocks.readStorefrontPdpCoreSnapshot.mockResolvedValue({
    status: 'found',
    value: {
      kind: 'product',
      product: {
        id: '44444444-4444-4444-8444-444444444444',
        merchant_id: merchantId,
        slug: 'phone-15',
        name: 'Phone 15',
        status: 'active',
        price: 300_000,
        has_variants: false,
        has_condition_offers: false,
        manage_stock: true,
        stock_quantity: 5,
        stock: 5,
        images: ['https://cdn.example.test/phone.jpg'],
        condition: 'new',
        product_variants: [],
      },
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('Chatwoot product lookup route', () => {
  it('rejects CSRF before reading the request body', async () => {
    mocks.checkCsrfProtection.mockResolvedValueOnce({ valid: false });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.readCartJsonBody).not.toHaveBeenCalled();
  });

  it('validates input before resolving a merchant session', async () => {
    arrange({ ...body, slug: 'not a slug' });

    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'invalid_request',
    });
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
  });

  it('requires the signed capability conversation to match', async () => {
    arrange(body, 906);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.readStorefrontPdpCoreSnapshot).not.toHaveBeenCalled();
  });

  it('returns a private canonical card and performs no cart mutation', async () => {
    arrange();

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      ok: true,
      requestId: body.requestId,
      product: {
        slug: 'phone-15',
        name: 'Phone 15',
        price: 300_000,
        currency: 'NGN',
        availability: 'in_stock',
        image: 'https://cdn.example.test/phone.jpg',
        condition: 'new',
        variants: [],
      },
    });
    expect(mocks.readStorefrontPdpCoreSnapshot).toHaveBeenCalledWith(
      expect.any(Object),
      { merchantId, productSlug: 'phone-15' }
    );
    expect(mocks.lookupMerchantCurrency).toHaveBeenCalledOnce();
    expect(mocks.checkCartQuota).toHaveBeenCalledWith({
      merchantId,
      operation: 'snapshot',
      subject: 'buyer-1',
    });
  });

  it('makes unsupported condition offers explicit to the widget', async () => {
    arrange();
    const snapshotCall = mocks.readStorefrontPdpCoreSnapshot;
    snapshotCall.mockResolvedValueOnce({
      status: 'found',
      value: {
        kind: 'product',
        product: {
          id: '44444444-4444-4444-8444-444444444444',
          merchant_id: merchantId,
          slug: 'phone-15',
          name: 'Phone 15',
          status: 'active',
          price: 300_000,
          has_condition_offers: true,
        },
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'unsupported_condition_offers',
      requestId: body.requestId,
    });
  });

  it('returns 404 when the canonical product projection is unavailable', async () => {
    arrange();
    mocks.readStorefrontPdpCoreSnapshot.mockResolvedValueOnce({
      status: 'found',
      value: {
        kind: 'product',
        product: {
          id: '44444444-4444-4444-8444-444444444444',
          merchant_id: merchantId,
          slug: 'phone-15',
          name: 'Phone 15',
          status: 'active',
          price: 300_000,
          has_condition_offers: false,
          // Unknown variant model must fail closed instead of treating it as simple.
        },
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'product_unavailable',
      requestId: body.requestId,
    });
  });
});
