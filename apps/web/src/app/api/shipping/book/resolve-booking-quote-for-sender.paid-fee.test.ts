import { beforeEach, describe, expect, it, vi } from 'vitest';
import { priceGiglQuote } from '@/lib/shipping/gigl-platform-pricing';
import {
  correctedSender,
  createRefreshOrderQuote,
} from '@/lib/shipping/refresh-order-shipment-quote.test-support';

vi.mock('@/lib/shipping', () => ({
  shippingService: { getProviderQuotes: vi.fn() },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getSupabaseServiceRoleKey: () => 's'.repeat(32),
}));

const { resolveBookingQuoteForSender } = await import(
  './resolve-booking-quote-for-sender'
);
const { shippingService } = await import('@/lib/shipping');

describe('bugfix: direct GIGL booking of an order paid at an unrounded v1 fee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fresh tariff unchanged, but the new rule rounds it up to NGN 126,000.
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      {
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
        ...priceGiglQuote(114_534.49),
      },
    ]);
  });

  it('refreshes an expired quote at the fee the customer paid', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: null }) };

    const result = await resolveBookingQuoteForSender(
      supabase as never,
      createRefreshOrderQuote({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      'GIGL',
      {
        orderId: 'order-1',
        merchantSender: correctedSender,
        usesStoredInternationalSender: false,
        expectedShippingFee: 125_987.94,
      }
    );

    expect(result).toMatchObject({
      price: 125_987.94,
      provider_cost: 114_534.49,
      platform_margin: 11_453.45,
      pricing_version: 'gigl_platform_margin_v1',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_refreshed_order_shipping_quote',
      expect.objectContaining({
        p_quote: expect.objectContaining({
          price: 125_987.94,
          platform_margin: 11_453.45,
        }),
      })
    );
  });

  it('still rejects the refresh when the paid fee matches neither v1 price', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: null }) };

    await expect(
      resolveBookingQuoteForSender(
        supabase as never,
        createRefreshOrderQuote({
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
        'GIGL',
        {
          orderId: 'order-1',
          merchantSender: correctedSender,
          usesStoredInternationalSender: false,
          expectedShippingFee: 125_000,
        }
      )
    ).rejects.toMatchObject({ code: 'QUOTE_PRICE_CHANGED', status: 400 });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
