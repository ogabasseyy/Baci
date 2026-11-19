import { NextResponse } from 'next/server';
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
  binding,
  cartContextState,
  loadedContext,
  request,
} from './route-test-fixtures';

beforeEach(() => {
  vi.clearAllMocks();
  applyDefaultDeliveryOptionsMocks(mocks);
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

  it('passes a decimal-safe NGN subtotal to merchant tier lookup', async () => {
    mocks.loadChatwootCartContext
      .mockResolvedValueOnce(
        loadedContext({
          subtotalMinor: 199,
          totalMinor: 199,
          lines: [
            {
              id: 'server-line-1',
              item: { productId: 'server-product-1' },
              quantity: 1,
              unitPriceMinor: 199,
              lineTotalMinor: 199,
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        loadedContext({
          subtotalMinor: 199,
          totalMinor: 199,
          lines: [
            {
              id: 'server-line-1',
              item: { productId: 'server-product-1' },
              quantity: 1,
              unitPriceMinor: 199,
              lineTotalMinor: 199,
            },
          ],
        })
      );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.loadChatwootMerchantCurrency).toHaveBeenCalledTimes(2);
    expect(mocks.loadPublicMerchantRates).toHaveBeenCalledWith(
      binding.merchantId,
      expect.objectContaining({ cartSubtotal: 1.99 })
    );
  });

  it('accepts legacy quote RPCs without explicit currency projections', async () => {
    mocks.loadPublicMerchantRates.mockResolvedValueOnce({
      quotes: [
        {
          provider: 'MERCHANT',
          displayName: 'Store pickup',
          price: 0,
          currency: 'NGN',
          isStationPickup: true,
          stationName: 'Ikeja collection point',
          stationAddress: 'Ikeja, Lagos',
        },
      ],
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.loadPublicMerchantRates).toHaveBeenCalledWith(
      binding.merchantId,
      expect.objectContaining({ merchantCurrency: 'NGN' })
    );
    expect(mocks.loadChatwootMerchantCurrency).toHaveBeenCalledTimes(2);
  });

  it('rejects rates when the current merchant currency cannot be resolved', async () => {
    mocks.loadChatwootMerchantCurrency.mockResolvedValueOnce(null);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'merchant_context_unavailable',
    });
    expect(mocks.loadPublicMerchantRates).not.toHaveBeenCalled();
  });

  it('returns unavailable when the merchant has no delivery rates', async () => {
    mocks.loadPublicMerchantRates.mockResolvedValueOnce({
      resolvedCountry: 'NG',
      resolvedCurrency: 'NGN',
      quotes: [],
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'no_delivery_options',
    });
  });
});
