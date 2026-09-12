import { describe, expect, it, vi } from 'vitest';
import { getShippingQuoteBookingMetadata } from './shipping-quote-booking-metadata';

describe('getShippingQuoteBookingMetadata', () => {
  it('returns null when the client has no RPC capability', async () => {
    await expect(
      getShippingQuoteBookingMetadata(
        { rpc: undefined } as never,
        'merchant-1',
        'order-1',
        'quote-1'
      )
    ).resolves.toBeNull();
  });

  it('passes the scoped booking identifiers to the RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { pricingTier: 'Premium', serviceType: 'Express', cost: 1000 },
      error: null,
    });

    await expect(
      getShippingQuoteBookingMetadata(
        { rpc } as never,
        'merchant-1',
        'order-1',
        'quote-1'
      )
    ).resolves.toEqual({
      pricingTier: 'Premium',
      serviceType: 'Express',
      cost: 1000,
    });
    expect(rpc).toHaveBeenCalledWith('get_shipping_quote_booking_metadata', {
      p_merchant_id: 'merchant-1',
      p_order_id: 'order-1',
      p_quote_id: 'quote-1',
    });
  });

  it('strips unexpected fields from the provider response', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        pricingTier: 'Premium',
        serviceType: 'Express',
        cost: 1000,
        providerTariff: 900,
      },
      error: null,
    });

    await expect(
      getShippingQuoteBookingMetadata(
        { rpc } as never,
        'merchant-1',
        'order-1',
        'quote-1'
      )
    ).resolves.toEqual({
      pricingTier: 'Premium',
      serviceType: 'Express',
      cost: 1000,
    });
  });

  it('maps an RPC failure to a booking error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'metadata lookup failed' },
    });

    await expect(
      getShippingQuoteBookingMetadata(
        { rpc } as never,
        'merchant-1',
        'order-1',
        'quote-1'
      )
    ).rejects.toMatchObject({
      code: 'QUOTE_METADATA_LOOKUP_FAILED',
      status: 500,
    });
  });
});
