import { NextRequest } from 'next/server';
import type { vi } from 'vitest';

export const binding = {
  inboxId: 74,
  merchantId: '6df442af-4d21-4f4f-9f0b-607400000001',
  origin: 'https://shop.example.com',
  websiteToken: 'synthetic-widget-token-123456',
};
export const cartContextState = {
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
export const cart = {
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

export function request() {
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

export function loadedContext(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    binding,
    state: cartContextState,
    cart: { ...cart, ...overrides },
  };
}

type Mocks = Record<
  | 'checkCsrfProtection'
  | 'loadChatwootCartContext'
  | 'loadChatwootMerchantCurrency'
  | 'loadPublicMerchantRates'
  | 'readCartJsonBody'
  | 'verifyChatwootSessionCapability',
  ReturnType<typeof vi.fn>
>;

/** Reset the route mocks to the happy-path defaults. */
export function applyDefaultDeliveryOptionsMocks(mocks: Mocks) {
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
  mocks.loadChatwootMerchantCurrency.mockResolvedValue({
    country: 'NG',
    currency: 'NGN',
  });
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
}
