import { describe, expect, it, vi } from 'vitest';
import {
  applyShippingQuoteBookingEconomicsToOrder,
  applyShippingQuoteBookingEconomicsToQuote,
  getShippingQuoteBookingEconomics,
} from './shipping-quote-booking-economics';

describe('getShippingQuoteBookingEconomics', () => {
  it('returns null when the client has no RPC capability', async () => {
    await expect(
      getShippingQuoteBookingEconomics(
        { rpc: undefined } as never,
        'merchant-1',
        'order-1',
        'quote-1'
      )
    ).resolves.toBeNull();
  });

  it('passes the scoped booking identifiers to the RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        provider_cost: 1000,
        platform_margin: 100,
        platform_margin_bps: 400,
        pricing_version: 'gigl_platform_margin_v1',
        shipping_provider_cost: 1000,
        shipping_platform_margin: 100,
        shipping_pricing_version: 'gigl_platform_margin_v1',
      },
      error: null,
    });

    await expect(
      getShippingQuoteBookingEconomics(
        { rpc } as never,
        'merchant-1',
        'order-1',
        'quote-1'
      )
    ).resolves.toEqual({
      provider_cost: 1000,
      platform_margin: 100,
      platform_margin_bps: 400,
      pricing_version: 'gigl_platform_margin_v1',
      shipping_provider_cost: 1000,
      shipping_platform_margin: 100,
      shipping_platform_retained_amount: null,
      shipping_pricing_version: 'gigl_platform_margin_v1',
    });
    expect(rpc).toHaveBeenCalledWith('get_shipping_quote_booking_economics', {
      p_merchant_id: 'merchant-1',
      p_order_id: 'order-1',
      p_quote_id: 'quote-1',
    });
  });

  it('strips unexpected fields from the provider response', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        provider_cost: 1000,
        platform_margin: 100,
        platform_margin_bps: 400,
        pricing_version: 'gigl_platform_margin_v1',
        provider_metadata: { secret: true },
      },
      error: null,
    });

    await expect(
      getShippingQuoteBookingEconomics(
        { rpc } as never,
        'merchant-1',
        'order-1',
        'quote-1'
      )
    ).resolves.toEqual({
      provider_cost: 1000,
      platform_margin: 100,
      platform_margin_bps: 400,
      pricing_version: 'gigl_platform_margin_v1',
      shipping_provider_cost: null,
      shipping_platform_margin: null,
      shipping_platform_retained_amount: null,
      shipping_pricing_version: null,
    });
  });

  it('maps an RPC failure to a booking error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'economics lookup failed' },
    });

    await expect(
      getShippingQuoteBookingEconomics(
        { rpc } as never,
        'merchant-1',
        'order-1',
        'quote-1'
      )
    ).rejects.toMatchObject({
      code: 'QUOTE_ECONOMICS_LOOKUP_FAILED',
      status: 500,
    });
  });
});

describe('applyShippingQuoteBookingEconomics helpers', () => {
  it('merges quote and order economics snapshots', () => {
    const economics = {
      provider_cost: 900,
      platform_margin: 90,
      platform_margin_bps: 400,
      pricing_version: 'gigl_platform_margin_v1',
      shipping_provider_cost: 1000,
      shipping_platform_margin: 100,
      shipping_platform_retained_amount: null,
      shipping_pricing_version: 'gigl_platform_margin_v1',
    };

    expect(
      applyShippingQuoteBookingEconomicsToQuote({ id: 'quote-1' }, economics)
    ).toEqual({
      id: 'quote-1',
      provider_cost: 900,
      platform_margin: 90,
      platform_margin_bps: 400,
      pricing_version: 'gigl_platform_margin_v1',
    });
    expect(
      applyShippingQuoteBookingEconomicsToOrder({ id: 'order-1' }, economics)
    ).toEqual({
      id: 'order-1',
      shipping_provider_cost: 1000,
      shipping_platform_margin: 100,
      shipping_platform_retained_amount: null,
      shipping_pricing_version: 'gigl_platform_margin_v1',
    });
  });
});
