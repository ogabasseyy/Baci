import { describe, expect, it, vi } from 'vitest';

vi.mock('./shipping-quote-booking-metadata', () => ({
  getShippingQuoteBookingMetadata: vi.fn(),
}));

const { attachBookingQuoteMetadata } = await import(
  './attach-booking-quote-metadata'
);
const { getShippingQuoteBookingMetadata } = await import(
  './shipping-quote-booking-metadata'
);

describe('attachBookingQuoteMetadata', () => {
  it('attaches the sanitized, order-scoped metadata projection', async () => {
    vi.mocked(getShippingQuoteBookingMetadata).mockResolvedValue({
      pricingTier: 'Premium',
      serviceType: 'Express',
      cost: 1000,
    });
    const quote = {
      id: 'quote-1',
      merchant_id: 'merchant-1',
      provider: 'GIGL',
      service_tier: 'GoStandard',
      carrier_name: 'GIG Logistics',
      price: 2500,
      currency: 'NGN',
      estimated_days: 3,
      provider_rate_id: 'GIGL_4_0',
      expires_at: '2099-01-01T00:00:00.000Z',
      quote_request: {},
      provider_metadata: null,
    };

    await expect(
      attachBookingQuoteMetadata({} as never, 'merchant-1', 'order-1', quote)
    ).resolves.toMatchObject({ provider_metadata: { cost: 1000 } });
    expect(getShippingQuoteBookingMetadata).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      'order-1',
      'quote-1'
    );
  });
});
