import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ChatwootCommerceContextError: class ChatwootCommerceContextError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
  loadChatwootCartContext: vi.fn(),
  loadChatwootMerchantCurrency: vi.fn(),
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
vi.mock('@/lib/chatwoot/merchant-currency', () => ({
  loadChatwootMerchantCurrency: mocks.loadChatwootMerchantCurrency,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  ChatwootCommerceContextError: mocks.ChatwootCommerceContextError,
  verifyChatwootSessionCapability: mocks.verifyChatwootSessionCapability,
}));
vi.mock('@/app/api/shipping/quotes/load-public-merchant-rates', () => ({
  loadPublicMerchantRates: mocks.loadPublicMerchantRates,
}));

import { POST } from './route';

import {
  applyDefaultDeliveryOptionsMocks,
  cart,
  loadedContext,
  request,
} from './route-test-fixtures';

beforeEach(() => {
  vi.clearAllMocks();
  applyDefaultDeliveryOptionsMocks(mocks);
});

describe('POST /api/storefront/chatwoot/context/delivery-options (rechecks)', () => {
  it('preserves authorization errors during the post-rate session recheck', async () => {
    mocks.verifyChatwootSessionCapability
      .mockResolvedValueOnce({
        conversationId: 905,
        sessionExpiresAt: 1_799_000_000,
      })
      .mockRejectedValueOnce(
        new mocks.ChatwootCommerceContextError('invalid_session')
      );

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'invalid_session' });
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

  it('reapplies line totals and subtotal invariants after rate lookup', async () => {
    mocks.loadChatwootCartContext
      .mockResolvedValueOnce(loadedContext())
      .mockResolvedValueOnce(
        loadedContext({
          lines: [
            {
              ...cart.lines[0],
              lineTotalMinor: 249_999,
            },
          ],
        })
      );

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'cart_changed' });
  });

  it('rejects changed lines even when the version and subtotal are unchanged', async () => {
    mocks.loadChatwootCartContext
      .mockResolvedValueOnce(loadedContext())
      .mockResolvedValueOnce(
        loadedContext({
          lines: [
            {
              ...cart.lines[0],
              item: { productId: 'substituted-product' },
            },
          ],
        })
      );

    const response = await POST(request());

    expect(response.status).toBe(409);
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
    expect((await POST(request())).status).toBe(409);
  });
});
