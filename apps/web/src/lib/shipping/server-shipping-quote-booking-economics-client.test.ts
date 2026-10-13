import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    brand: 'shipping-quote-booking-economics',
  })),
}));

describe('createShippingQuoteBookingEconomicsServiceClient', () => {
  it('constructs the dedicated shipping-quote-booking-economics sentinel', async () => {
    const { createServiceClient } = await import('@/lib/supabase/service');
    const { createShippingQuoteBookingEconomicsServiceClient } = await import(
      './server-shipping-quote-booking-economics-client'
    );

    expect(createShippingQuoteBookingEconomicsServiceClient()).toEqual({
      brand: 'shipping-quote-booking-economics',
    });
    expect(createServiceClient).toHaveBeenCalledWith(
      'shipping-quote-booking-economics'
    );
  });
});
