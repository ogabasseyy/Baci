import { describe, expect, it, vi } from 'vitest';
import {
  loadBoundAdminWalletGiglQuoteResponse,
  shouldReuseBoundAdminWalletGiglQuote,
} from './load-bound-admin-wallet-gigl-quote';

describe('shouldReuseBoundAdminWalletGiglQuote', () => {
  it('reuses a bound merchant-wallet GIGL quote outside preview', () => {
    expect(
      shouldReuseBoundAdminWalletGiglQuote(
        {
          selected_quote_id: 'quote-1',
          shipping_funding_source: 'merchant_wallet',
          shipping_provider: 'GIGL',
        },
        false
      )
    ).toBe('quote-1');
  });

  it('does not reuse preview requests or non-wallet orders', () => {
    expect(
      shouldReuseBoundAdminWalletGiglQuote(
        {
          selected_quote_id: 'quote-1',
          shipping_funding_source: 'merchant_wallet',
          shipping_provider: 'GIGL',
        },
        true
      )
    ).toBeNull();
    expect(
      shouldReuseBoundAdminWalletGiglQuote(
        {
          selected_quote_id: 'quote-1',
          shipping_funding_source: 'customer_checkout',
          shipping_provider: 'GIGL',
        },
        false
      )
    ).toBeNull();
  });
});

describe('loadBoundAdminWalletGiglQuoteResponse', () => {
  it('skips reuse when the latest charge for the bound quote was refunded', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'quote-1',
          provider: 'GIGL',
          service_tier: 'Express',
          carrier_name: 'GIG Logistics',
          price: 2500,
          currency: 'NGN',
          estimated_days: 1,
          expires_at: '2026-09-04T12:00:00.000Z',
          provider_rate_id: 'rate-1',
          is_station_pickup: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: 'refunded' },
        error: null,
      });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ eq, order, maybeSingle }));
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq })),
    }));
    const supabase = {
      from,
      rpc: vi.fn(),
    } as unknown as Parameters<typeof loadBoundAdminWalletGiglQuoteResponse>[0];

    await expect(
      loadBoundAdminWalletGiglQuoteResponse(supabase, 'merchant-1', 'quote-1')
    ).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('skips reuse when the bound quote is expired and has no active charge', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'quote-1',
          provider: 'GIGL',
          service_tier: 'Express',
          carrier_name: 'GIG Logistics',
          price: 2500,
          currency: 'NGN',
          estimated_days: 1,
          expires_at: '2020-01-01T00:00:00.000Z',
          provider_rate_id: 'rate-1',
          is_station_pickup: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: 'completed' },
        error: null,
      });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ eq, order, maybeSingle }));
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq })),
    }));
    const supabase = {
      from,
      rpc: vi.fn(),
    } as unknown as Parameters<typeof loadBoundAdminWalletGiglQuoteResponse>[0];

    await expect(
      loadBoundAdminWalletGiglQuoteResponse(supabase, 'merchant-1', 'quote-1')
    ).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('reuses an expired bound quote when a reserved charge is still active', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'quote-1',
          provider: 'GIGL',
          service_tier: 'Express',
          carrier_name: 'GIG Logistics',
          price: 2500,
          currency: 'NGN',
          estimated_days: 1,
          expires_at: '2020-01-01T00:00:00.000Z',
          provider_rate_id: 'rate-1',
          is_station_pickup: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: 'reserved' },
        error: null,
      });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ eq, order, maybeSingle }));
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq })),
    }));
    const supabase = {
      from,
      rpc: vi.fn().mockResolvedValue({
        data: [{ available_balance: 10_000 }],
        error: null,
      }),
    } as unknown as Parameters<typeof loadBoundAdminWalletGiglQuoteResponse>[0];

    const response = await loadBoundAdminWalletGiglQuoteResponse(
      supabase,
      'merchant-1',
      'quote-1'
    );

    expect(response).not.toBeNull();
    await expect(response?.json()).resolves.toMatchObject({
      quote: { id: 'quote-1', provider: 'GIGL' },
      canBook: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_wallet_summary', {
      p_merchant_id: 'merchant-1',
    });
  });

  it('allows booking resume when a reserved charge exists even if wallet balance is short', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'quote-1',
          provider: 'GIGL',
          service_tier: 'Express',
          carrier_name: 'GIG Logistics',
          price: 2500,
          currency: 'NGN',
          estimated_days: 1,
          expires_at: '2026-09-04T12:00:00.000Z',
          provider_rate_id: 'rate-1',
          is_station_pickup: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: 'reserved' },
        error: null,
      });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ eq, order, maybeSingle }));
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq })),
    }));
    const supabase = {
      from,
      rpc: vi.fn().mockResolvedValue({
        data: [{ available_balance: 100 }],
        error: null,
      }),
    } as unknown as Parameters<typeof loadBoundAdminWalletGiglQuoteResponse>[0];

    const response = await loadBoundAdminWalletGiglQuoteResponse(
      supabase,
      'merchant-1',
      'quote-1'
    );

    expect(response).not.toBeNull();
    await expect(response?.json()).resolves.toMatchObject({
      quote: { id: 'quote-1' },
      availableBalance: 100,
      shortfall: 0,
      canBook: true,
    });
  });

  it('invalidates a bound quote when nested product weight no longer matches', async () => {
    const maybeSingle = vi.fn().mockResolvedValueOnce({
      data: {
        id: 'quote-1',
        provider: 'GIGL',
        service_tier: 'Express',
        carrier_name: 'GIG Logistics',
        price: 2500,
        currency: 'NGN',
        estimated_days: 1,
        expires_at: '2026-09-04T12:00:00.000Z',
        provider_rate_id: 'rate-1',
        is_station_pickup: false,
        quote_request: {
          shipmentType: 'domestic',
          receiver: {
            name: 'Amina',
            phone: '+2348000000000',
            address: '12 Allen Avenue',
            city: 'Ikeja',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
          items: [{ name: 'Phone', quantity: 1, value: 100_000, weight: 1 }],
          sender: {
            name: 'Store',
            phone: '+2348111111111',
            address: '1 Broad St',
            city: 'Lagos',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
        },
      },
      error: null,
    });
    const eq = vi.fn(() => ({ eq, maybeSingle }));
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq })),
    }));
    const supabase = {
      from,
      rpc: vi.fn(),
    } as unknown as Parameters<typeof loadBoundAdminWalletGiglQuoteResponse>[0];

    await expect(
      loadBoundAdminWalletGiglQuoteResponse(supabase, 'merchant-1', 'quote-1', {
        shipping_address: {
          address: '12 Allen Avenue',
          city: 'Ikeja',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
        },
        order_items: [
          {
            name: 'Phone',
            quantity: 1,
            price: 100_000,
            product: { weight_value: 2.5, weight_unit: 'kg' },
          },
        ],
      })
    ).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('invalidates a bound quote when the order destination no longer matches', async () => {
    const maybeSingle = vi.fn().mockResolvedValueOnce({
      data: {
        id: 'quote-1',
        provider: 'GIGL',
        service_tier: 'Express',
        carrier_name: 'GIG Logistics',
        price: 2500,
        currency: 'NGN',
        estimated_days: 1,
        expires_at: '2026-09-04T12:00:00.000Z',
        provider_rate_id: 'rate-1',
        is_station_pickup: false,
        quote_request: {
          shipmentType: 'domestic',
          receiver: {
            name: 'Amina',
            phone: '+2348000000000',
            address: '12 Allen Avenue',
            city: 'Ikeja',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
          items: [{ name: 'Phone', quantity: 1, value: 100_000, weight: 1 }],
          sender: {
            name: 'Store',
            phone: '+2348111111111',
            address: '1 Broad St',
            city: 'Lagos',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
        },
      },
      error: null,
    });
    const eq = vi.fn(() => ({ eq, maybeSingle }));
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq })),
    }));
    const supabase = {
      from,
      rpc: vi.fn(),
    } as unknown as Parameters<typeof loadBoundAdminWalletGiglQuoteResponse>[0];

    await expect(
      loadBoundAdminWalletGiglQuoteResponse(supabase, 'merchant-1', 'quote-1', {
        shipping_address: {
          address: '99 Different Street',
          city: 'Abuja',
          state: 'FCT',
          country: 'Nigeria',
          countryCode: 'NG',
        },
        order_items: [{ name: 'Phone', quantity: 1, price: 100_000 }],
      })
    ).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('invalidates a bound quote when order items no longer match', async () => {
    const maybeSingle = vi.fn().mockResolvedValueOnce({
      data: {
        id: 'quote-1',
        provider: 'GIGL',
        service_tier: 'Express',
        carrier_name: 'GIG Logistics',
        price: 2500,
        currency: 'NGN',
        estimated_days: 1,
        expires_at: '2026-09-04T12:00:00.000Z',
        provider_rate_id: 'rate-1',
        is_station_pickup: false,
        quote_request: {
          shipmentType: 'domestic',
          receiver: {
            name: 'Amina',
            phone: '+2348000000000',
            address: '12 Allen Avenue',
            city: 'Ikeja',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
          items: [{ name: 'Phone', quantity: 1, value: 100_000, weight: 1 }],
          sender: {
            name: 'Store',
            phone: '+2348111111111',
            address: '1 Broad St',
            city: 'Lagos',
            state: 'Lagos',
            country: 'Nigeria',
            countryCode: 'NG',
          },
        },
      },
      error: null,
    });
    const eq = vi.fn(() => ({ eq, maybeSingle }));
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq })),
    }));
    const supabase = {
      from,
      rpc: vi.fn(),
    } as unknown as Parameters<typeof loadBoundAdminWalletGiglQuoteResponse>[0];

    await expect(
      loadBoundAdminWalletGiglQuoteResponse(supabase, 'merchant-1', 'quote-1', {
        shipping_address: {
          address: '12 Allen Avenue',
          city: 'Ikeja',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
        },
        order_items: [{ name: 'Phone', quantity: 2, price: 100_000 }],
      })
    ).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('bugfix: reuses an expired bound quote when the charge is already booked', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'quote-1',
          provider: 'GIGL',
          service_tier: 'Express',
          carrier_name: 'GIG Logistics',
          price: 2500,
          currency: 'NGN',
          estimated_days: 1,
          expires_at: '2020-01-01T00:00:00.000Z',
          provider_rate_id: 'rate-1',
          is_station_pickup: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: 'booked' },
        error: null,
      });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ eq, order, maybeSingle }));
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq })),
    }));
    const supabase = {
      from,
      rpc: vi.fn().mockResolvedValue({
        data: [{ available_balance: 0 }],
        error: null,
      }),
    } as unknown as Parameters<typeof loadBoundAdminWalletGiglQuoteResponse>[0];

    const response = await loadBoundAdminWalletGiglQuoteResponse(
      supabase,
      'merchant-1',
      'quote-1'
    );

    expect(response).not.toBeNull();
    await expect(response?.json()).resolves.toMatchObject({
      quote: { id: 'quote-1', provider: 'GIGL' },
      canBook: true,
      shortfall: 0,
      boundChargeRecovery: true,
    });
  });

  it('bugfix: reuses a bound quote for coordinate-only destinations without city/state', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'quote-1',
          provider: 'GIGL',
          service_tier: 'Express',
          carrier_name: 'GIG Logistics',
          price: 2500,
          currency: 'NGN',
          estimated_days: 1,
          expires_at: '2026-09-04T12:00:00.000Z',
          provider_rate_id: 'rate-1',
          is_station_pickup: false,
          quote_request: {
            shipmentType: 'domestic',
            receiver: {
              name: 'Amina',
              phone: '+2348000000000',
              address: '12 Allen Avenue',
              city: '',
              state: '',
              country: 'Nigeria',
              countryCode: 'NG',
              latitude: 6.6018,
              longitude: 3.3515,
            },
            items: [{ name: 'Phone', quantity: 1, value: 100_000, weight: 1 }],
            sender: {
              name: 'Store',
              phone: '+2348111111111',
              address: '1 Broad St',
              city: 'Lagos',
              state: 'Lagos',
              country: 'Nigeria',
              countryCode: 'NG',
            },
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: 'reserved' },
        error: null,
      });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ eq, order, maybeSingle }));
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq })),
    }));
    const supabase = {
      from,
      rpc: vi.fn().mockResolvedValue({
        data: [{ available_balance: 10_000 }],
        error: null,
      }),
    } as unknown as Parameters<typeof loadBoundAdminWalletGiglQuoteResponse>[0];

    const response = await loadBoundAdminWalletGiglQuoteResponse(
      supabase,
      'merchant-1',
      'quote-1',
      {
        shipping_address: {
          address: '12 Allen Avenue',
          city: null,
          state: null,
          country: 'Nigeria',
          countryCode: 'NG',
          latitude: 6.6018,
          longitude: 3.3515,
        },
        order_items: [{ name: 'Phone', quantity: 1, price: 100_000 }],
      }
    );

    expect(response).not.toBeNull();
    await expect(response?.json()).resolves.toMatchObject({
      quote: { id: 'quote-1' },
      canBook: true,
    });
  });
});
