import { beforeEach, describe, expect, it, vi } from 'vitest';
import { priceGiglQuote } from './gigl-platform-pricing';
import {
  correctedSender,
  createRefreshOrderQuote,
} from './refresh-order-shipment-quote.test-support';
import type { ShippingQuote } from './types';

vi.mock('@/lib/shipping', () => ({
  shippingService: { getProviderQuotes: vi.fn() },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getSupabaseServiceRoleKey: () => 's'.repeat(32),
}));

const { refreshOrderShipmentQuote } = await import(
  './refresh-order-shipment-quote'
);
const { shippingService } = await import('@/lib/shipping');

function freshGiglQuote(providerCost: number): ShippingQuote {
  return {
    id: 'quote-refreshed',
    provider: 'GIGL',
    serviceTier: 'GoStandard',
    carrierName: 'GIG Logistics',
    displayName: 'GIG Logistics - GoStandard',
    currency: 'NGN',
    estimatedDays: 3,
    pickupIncluded: true,
    insuranceIncluded: false,
    providerRateId: 'GIGL_4_0',
    expiresAt: new Date(Date.now() + 86_400_000),
    ...priceGiglQuote(providerCost),
  };
}

function persistedQuote(supabase: { rpc: ReturnType<typeof vi.fn> }) {
  const [, args] = supabase.rpc.mock.calls[0] as [
    string,
    { p_quote: Record<string, unknown> },
  ];
  return args.p_quote;
}

const expiredQuote = () =>
  createRefreshOrderQuote({
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });

describe('bugfix: orders paid at an unrounded v1 GIGL fee survive NGN 100 rounding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      freshGiglQuote(44_091.27),
    ]);
  });

  it('books at the paid fee when the fresh cost reproduces the unrounded v1 price', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: null }) };

    const result = await refreshOrderShipmentQuote(
      supabase as never,
      expiredQuote(),
      'GIGL',
      correctedSender,
      { orderId: 'order-1', expectedShippingFee: '48500.40' }
    );

    expect(result).toMatchObject({
      id: 'quote-refreshed',
      price: 48_500.4,
      provider_cost: 44_091.27,
      platform_margin: 4_409.13,
      platform_margin_bps: 1000,
      pricing_version: 'gigl_platform_margin_v1',
    });
    expect(persistedQuote(supabase)).toMatchObject({
      id: 'quote-refreshed',
      price: 48_500.4,
      provider_cost: 44_091.27,
      platform_margin: 4_409.13,
      platform_margin_bps: 1000,
      pricing_version: 'gigl_platform_margin_v1',
    });
  });

  it('keeps the rounded price when the paid fee already equals it', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: null }) };

    const result = await refreshOrderShipmentQuote(
      supabase as never,
      expiredQuote(),
      'GIGL',
      correctedSender,
      { orderId: 'order-1', expectedShippingFee: 48_600 }
    );

    expect(result.price).toBe(48_600);
    expect(result.platform_margin).toBe(4_508.73);
    expect(persistedQuote(supabase)).toMatchObject({ price: 48_600 });
  });

  it('still rejects a real tariff change before persisting', async () => {
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValueOnce([
      freshGiglQuote(45_000.01),
    ]);
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: null }) };

    await expect(
      refreshOrderShipmentQuote(
        supabase as never,
        expiredQuote(),
        'GIGL',
        correctedSender,
        { orderId: 'order-1', expectedShippingFee: 48_500.4 }
      )
    ).rejects.toMatchObject({ code: 'QUOTE_PRICE_CHANGED', status: 400 });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('keeps the rounded price for refreshes with no paid fee to match', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: null }) };

    const result = await refreshOrderShipmentQuote(
      supabase as never,
      expiredQuote(),
      'GIGL',
      correctedSender,
      { orderId: 'order-1' }
    );

    expect(result.price).toBe(48_600);
    expect(persistedQuote(supabase)).toMatchObject({ price: 48_600 });
  });
});
