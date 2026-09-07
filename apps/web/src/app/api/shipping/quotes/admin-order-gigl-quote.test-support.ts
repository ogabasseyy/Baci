import { NextRequest } from 'next/server';
import { vi } from 'vitest';

export const mocks = {
  authenticateApiRequest: vi.fn(),
  getUserAccess: vi.fn(),
  hasPermission: vi.fn(),
  checkCsrfProtection: vi.fn(),
  createAdminClient: vi.fn(),
  buildOrderGiglQuoteRequest: vi.fn(),
  resolveBookingMerchantSender: vi.fn(),
  getProviderQuotes: vi.fn(),
  persistRpc: vi.fn(),
  persistAdminGiglQuote: vi.fn(),
  bindRpc: vi.fn(),
};

export const orderId = '11111111-1111-4111-8111-111111111111';
export const quoteId = '22222222-2222-4222-8222-222222222222';
export const merchantId = '33333333-3333-4333-8333-333333333333';
export const receiver = {
  phone: '08011112222',
  address: '5 Balogun Street',
  city: 'Ikeja',
  state: 'Lagos',
};
export const sender = {
  name: 'Merchant Store',
  phone: '08012345678',
  address: '1 Merchant Road',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};
export const builtRequest = {
  sessionId: orderId,
  sender,
  receiver,
  items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
  shipmentType: 'domestic' as const,
  deliveryPreference: 'door' as const,
};
export const quote = {
  id: quoteId,
  provider: 'GIGL' as const,
  serviceTier: 'Standard',
  carrierName: 'GIG Logistics',
  displayName: 'Standard Delivery',
  estimatedDays: 2,
  price: 11_000,
  providerCost: 10_000,
  platformMargin: 1_000,
  marginBasisPoints: 1_000,
  pricingVersion: 'gigl_platform_margin_v1',
  currency: 'NGN' as const,
  pickupIncluded: true,
  insuranceIncluded: true,
  providerRateId: 'rate-1',
  expiresAt: new Date(Date.now() + 60_000),
  rawResponse: { secretProviderPayload: 'must-not-leak' },
  isStationPickup: false,
};

export function request(
  body: unknown = {},
  headers: Record<string, string> = {}
) {
  return new NextRequest('https://usebaci.com/api/shipping/quotes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-baci-admin-order-mode': '1',
      'x-baci-admin-order-id': orderId,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export function orderQuery(
  data: unknown = { id: orderId, shipping_status: 'processing' }
) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function authenticatedQuery(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

export function setup(
  overrides: {
    order?: unknown;
    orderError?: unknown;
    merchant?: unknown;
    merchantError?: unknown;
    featureSettings?: unknown;
    featureError?: unknown;
  } = {}
) {
  const order = orderQuery(
    Object.hasOwn(overrides, 'order')
      ? overrides.order
      : { id: orderId, shipping_status: 'processing' }
  );
  if (overrides.orderError)
    order.maybeSingle.mockResolvedValue({
      data: null,
      error: overrides.orderError,
    });
  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'orders') return order;
      throw new Error(`unexpected table ${table}`);
    }),
    rpc: mocks.persistRpc,
  };
  const merchant = authenticatedQuery(
    Object.hasOwn(overrides, 'merchant')
      ? overrides.merchant
      : { country: 'NG', payout_currency: 'NGN' },
    overrides.merchantError
  );
  const featureSettings = authenticatedQuery(
    Object.hasOwn(overrides, 'featureSettings')
      ? overrides.featureSettings
      : { shipping_providers: ['gigl'] },
    overrides.featureError
  );
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'orders') return order;
      if (table === 'merchants') return merchant;
      if (table === 'merchant_feature_settings') return featureSettings;
      throw new Error(`unexpected authenticated table ${table}`);
    }),
    rpc: mocks.bindRpc,
  };
  mocks.authenticateApiRequest.mockResolvedValue({
    user: { id: 'user-1' },
    supabase,
  });
  mocks.getUserAccess.mockResolvedValue({
    isOwner: true,
    merchantId,
    permissions: {},
  });
  mocks.hasPermission.mockReturnValue(true);
  mocks.checkCsrfProtection.mockResolvedValue({ valid: true });
  mocks.createAdminClient.mockReturnValue(admin);
  mocks.resolveBookingMerchantSender.mockResolvedValue({ ok: true, sender });
  mocks.buildOrderGiglQuoteRequest.mockResolvedValue({
    ok: true,
    request: builtRequest,
  });
  mocks.getProviderQuotes.mockResolvedValue([quote]);
  mocks.persistRpc.mockResolvedValue({ data: quoteId, error: null });
  mocks.persistAdminGiglQuote.mockResolvedValue({ data: quoteId, error: null });
  mocks.bindRpc.mockResolvedValue({
    data: { available_balance: 20_000 },
    error: null,
  });
  return { admin, supabase, order, merchant, featureSettings };
}

export async function subject(
  body: unknown = {},
  headers: Record<string, string> = {}
) {
  const { postAdminOrderGiglQuote } = await import('./admin-order-gigl-quote');
  return postAdminOrderGiglQuote(request(body, headers));
}
