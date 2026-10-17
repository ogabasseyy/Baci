import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingService } from '@/lib/shipping';
import {
  type OrderShipmentQuoteRecord,
  refreshOrderShipmentQuote,
} from './refresh-order-shipment-quote';

vi.mock('@/lib/shipping', () => ({
  shippingService: { getProviderQuotes: vi.fn() },
}));
vi.mock('./persist-refreshed-shipping-quote', () => ({
  persistRefreshedShippingQuote: vi.fn(),
}));
const { persistRefreshedShippingQuote } = await import(
  './persist-refreshed-shipping-quote'
);
const sender = {
  name: 'Shop',
  phone: '08000000000',
  address: '1 Shop Road',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};
const request = {
  sessionId: 'session',
  shipmentType: 'domestic' as const,
  sender,
  receiver: {
    ...sender,
    address: '2 Buyer Road',
    latitude: 6.5,
    longitude: 3.3,
  },
  items: [{ name: 'Phone', quantity: 1, weight: 1, value: 5000 }],
};
const quote: OrderShipmentQuoteRecord = {
  id: 'saved',
  merchant_id: 'merchant',
  provider: 'GIGL',
  service_tier: 'GoStandard',
  carrier_name: 'GIG Logistics',
  price: 1100,
  currency: 'NGN',
  estimated_days: 3,
  provider_rate_id: 'GIGL_4_0',
  expires_at: '2020-01-01T00:00:00Z',
  quote_request: request,
  provider_metadata: null,
  provider_cost: 1000,
  platform_margin: 100,
  platform_margin_bps: 1000,
  pricing_version: 'gigl_platform_margin_v1',
};
const fresh = {
  id: 'new',
  provider: 'GIGL' as const,
  serviceTier: 'GoStandard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics',
  price: 1100,
  currency: 'NGN',
  providerCost: 1000,
  platformMargin: 100,
  marginBasisPoints: 1000,
  pricingVersion: 'gigl_platform_margin_v1',
  estimatedDays: 3,
  pickupIncluded: true,
  insuranceIncluded: false,
  providerRateId: 'GIGL_4_0',
  expiresAt: new Date('2099-01-01'),
  rawResponse: {},
};
// The new option is deliberately exercised before implementation.
const options = {
  orderId: 'order',
  expectedShippingFee: 1100,
  preserveSavedGiglCheckoutQuote: true,
};
const client = {} as SupabaseClient;

describe('saved paid GIG quote validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([fresh]);
    vi.mocked(persistRefreshedShippingQuote).mockResolvedValue({ error: null });
  });
  it.each([
    '2020-01-01',
    '2099-01-01',
  ])('checks current prices and reuses the exact saved quote with expiry %s', async (expiry) => {
    const saved = { ...quote, expires_at: expiry };
    expect(
      await refreshOrderShipmentQuote(client, saved, 'GIGL', sender, options)
    ).toBe(saved);
    expect(shippingService.getProviderQuotes).toHaveBeenCalledOnce();
    expect(persistRefreshedShippingQuote).not.toHaveBeenCalled();
  });
  it.each([
    { price: 1101 },
    { providerCost: 999 },
    { serviceTier: 'GoFaster' },
    { providerRateId: 'GIGL_5_0' },
    { currency: 'USD' },
  ])('requires confirmation before changing tariff or service %j', async (change) => {
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      { ...fresh, ...change },
    ]);
    await expect(
      refreshOrderShipmentQuote(client, quote, 'GIGL', sender, options)
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(persistRefreshedShippingQuote).not.toHaveBeenCalled();
  });
  it('reports unavailable pricing without claiming that details changed', async () => {
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([]);
    await expect(
      refreshOrderShipmentQuote(client, quote, 'GIGL', sender, options)
    ).rejects.toMatchObject({ code: 'QUOTE_REFRESH_FAILED', status: 409 });
    expect(persistRefreshedShippingQuote).not.toHaveBeenCalled();
  });
  it('rejects a saved quote bound to a different provider before fetching', async () => {
    await expect(
      refreshOrderShipmentQuote(
        client,
        { ...quote, provider: 'TOPSHIP' },
        'GIGL',
        sender,
        options
      )
    ).rejects.toMatchObject({ code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED' });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });
  it('requires confirmation for changed origin before requesting any tariff', async () => {
    await expect(
      refreshOrderShipmentQuote(
        client,
        quote,
        'GIGL',
        { ...sender, address: 'New origin' },
        options
      )
    ).rejects.toMatchObject({ code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED' });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
  });
});
