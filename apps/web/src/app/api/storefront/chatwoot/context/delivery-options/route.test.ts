import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ChatwootCommerceContextError: class ChatwootCommerceContextError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
  loadChatwootCartContext: vi.fn(),
  loadPublicMerchantRates: vi.fn(),
  readCartJsonBody: vi.fn(),
  verifyChatwootSessionCapability: vi.fn(),
}));

vi.mock('@/lib/cart/request-context', () => ({
  readCartJsonBody: mocks.readCartJsonBody,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/chatwoot/cart-context', () => ({
  loadChatwootCartContext: mocks.loadChatwootCartContext,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  ChatwootCommerceContextError: mocks.ChatwootCommerceContextError,
  verifyChatwootSessionCapability: mocks.verifyChatwootSessionCapability,
}));
vi.mock('@/app/api/shipping/quotes/load-public-merchant-rates', () => ({
  loadPublicMerchantRates: mocks.loadPublicMerchantRates,
}));

import { POST } from './route';

const binding = {
  inboxId: 74,
  merchantId: '6df442af-4d21-4f4f-9f0b-607400000001',
  origin: 'https://shop.example.com',
  websiteToken: 'synthetic-widget-token-123456',
};
const cartContextState = {
  cartId: '6df442af-4d21-4f4f-9f0b-607400000002',
  cartSessionSha256: 'a'.repeat(64),
  cartVersion: 12,
  grantId: '6df442af-4d21-4f4f-9f0b-607400000003',
  inboxId: binding.inboxId,
  merchantId: binding.merchantId,
  origin: binding.origin,
  principalId: '6df442af-4d21-4f4f-9f0b-607400000004',
  websiteToken: binding.websiteToken,
};
const cart = {
  cartId: cartContextState.cartId,
  merchantId: binding.merchantId,
  state: 'active',
  version: 12,
  currency: 'NGN',
  subtotalMinor: 250_000,
  totalMinor: 250_000,
  estimatedTotals: false,
  expiresAt: '2026-11-08T12:00:00.000Z',
  checkoutSessionId: 'private-checkout-session',
  lines: [
    {
      id: 'server-line-1',
      item: { productId: 'server-product-1' },
      quantity: 2,
      unitPriceMinor: 125_000,
      lineTotalMinor: 250_000,
      voucherToken: 'private-voucher-token',
    },
  ],
};

function request() {
  return new NextRequest(
    `${binding.origin}/api/storefront/chatwoot/context/delivery-options`,
    {
      method: 'POST',
      headers: {
        host: 'shop.example.com',
        origin: binding.origin,
        'content-type': 'application/json',
      },
    }
  );
}

function loadedContext(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    binding,
    state: cartContextState,
    cart: { ...cart, ...overrides },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkCsrfProtection.mockResolvedValue({ valid: true });
  mocks.readCartJsonBody.mockResolvedValue({
    ok: true,
    body: {
      sessionToken: 'signed-chatwoot-session',
      conversationId: 905,
      expectedCartVersion: 12,
      state: ' Lagos ',
    },
  });
  mocks.loadChatwootCartContext.mockResolvedValue(loadedContext());
  mocks.verifyChatwootSessionCapability.mockResolvedValue({
    conversationId: 905,
    sessionExpiresAt: 1_799_000_000,
  });
  mocks.loadPublicMerchantRates.mockResolvedValue({
    resolvedCountry: 'NG',
    resolvedCurrency: 'NGN',
    quotes: [
      {
        provider: 'MERCHANT',
        displayName: 'Store pickup',
        price: 0,
        currency: 'NGN',
        estimatedDays: 1,
        isStationPickup: true,
        stationName: 'Ikeja collection point',
        stationAddress: 'Ikeja, Lagos',
        stationInstructions: 'Ask at the store counter',
        providerRateId: 'private-provider-rate-id',
        providerCost: 900,
        rawResponse: { secret: 'must-not-leak' },
      },
    ],
  });
});

describe('POST /api/storefront/chatwoot/context/delivery-options', () => {
  it('uses a no-store failure envelope when CSRF validation fails', async () => {
    mocks.checkCsrfProtection.mockResolvedValueOnce({
      valid: false,
      response: NextResponse.json(
        { error: 'private csrf detail' },
        { status: 403 }
      ),
    } as never);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({
      error: 'Delivery options unavailable',
      code: 'forbidden',
    });
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
  });

  it('returns a no-store error envelope when the initial cart context load throws', async () => {
    mocks.loadChatwootCartContext.mockRejectedValueOnce(
      new Error('private database detail')
    );

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({
      error: 'Delivery options unavailable',
      code: 'cart_context_unavailable',
    });
    expect(mocks.loadPublicMerchantRates).not.toHaveBeenCalled();
  });

  it('uses the bound server cart subtotal and returns only a public estimate projection', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.verifyChatwootSessionCapability).toHaveBeenCalledWith({
      binding,
      sessionToken: 'signed-chatwoot-session',
      state: cartContextState,
    });
    expect(mocks.loadPublicMerchantRates).toHaveBeenCalledWith(
      binding.merchantId,
      {
        receiverCountryCode: 'NG',
        receiverState: 'Lagos',
        merchantCurrency: 'NGN',
        cartSubtotal: 2500,
      }
    );
    expect(mocks.loadChatwootCartContext).toHaveBeenCalledTimes(2);
    const body = await response.json();
    expect(body).toEqual({
      state: 'Lagos',
      cartVersion: 12,
      currency: 'NGN',
      subtotalMinor: 250_000,
      options: [
        {
          displayName: 'Store pickup',
          priceMajor: 0,
          currency: 'NGN',
          estimatedDays: 1,
          pickup: true,
          pickupLocation: 'Ikeja collection point · Ikeja, Lagos',
          pickupInstructions: 'Ask at the store counter',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('private-provider-rate-id');
    expect(JSON.stringify(body)).not.toContain('providerCost');
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
    expect(JSON.stringify(body)).not.toContain('private-voucher-token');
    expect(JSON.stringify(body)).not.toContain('private-checkout-session');
  });

  it('rejects stale carts before reading merchant rates', async () => {
    mocks.readCartJsonBody.mockResolvedValueOnce({
      ok: true,
      body: {
        sessionToken: 'signed-chatwoot-session',
        conversationId: 905,
        expectedCartVersion: 11,
        state: 'Lagos',
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.loadPublicMerchantRates).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized state without querying rates', async () => {
    mocks.readCartJsonBody.mockResolvedValueOnce({
      ok: true,
      body: {
        sessionToken: 'signed-chatwoot-session',
        conversationId: 905,
        expectedCartVersion: 12,
        state: 'Atlantis',
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.loadPublicMerchantRates).not.toHaveBeenCalled();
  });

  it('rechecks cart version after rate lookup and refuses a raced result', async () => {
    mocks.loadChatwootCartContext
      .mockResolvedValueOnce(loadedContext())
      .mockResolvedValueOnce(loadedContext({ version: 13 }));

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.verifyChatwootSessionCapability).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({ code: 'cart_changed' });
  });

  it('refuses estimated cart totals and failed or non-NGN rate context', async () => {
    mocks.loadChatwootCartContext.mockResolvedValueOnce(
      loadedContext({ estimatedTotals: true })
    );
    expect((await POST(request())).status).toBe(409);
    expect(mocks.loadPublicMerchantRates).not.toHaveBeenCalled();

    mocks.loadChatwootCartContext.mockResolvedValue(loadedContext());
    mocks.loadPublicMerchantRates.mockResolvedValueOnce({
      resolvedCurrency: 'USD',
      resolvedCountry: 'US',
      quotes: [],
    });
    expect((await POST(request())).status).toBe(503);
  });
});
