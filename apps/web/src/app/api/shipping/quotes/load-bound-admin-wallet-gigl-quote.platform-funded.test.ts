import { describe, expect, it, vi } from 'vitest';
import { loadBoundAdminWalletGiglQuoteResponse } from './load-bound-admin-wallet-gigl-quote';

describe('loadBoundAdminWalletGiglQuoteResponse for platform-funded merchants', () => {
  it('reports Paid by Baci and never reads the merchant wallet', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'quote-1',
          provider: 'GIGL',
          service_tier: 'Express',
          carrier_name: 'GIG Logistics',
          price: 4500,
          currency: 'NGN',
          estimated_days: 1,
          expires_at: '2999-01-01T00:00:00.000Z',
          provider_rate_id: 'rate-1',
          is_station_pickup: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ eq, order, maybeSingle }));
    const rpc = vi.fn(async (name: string) =>
      name === 'get_gigl_shipping_funding_mode'
        ? { data: 'platform', error: null }
        : { data: 0, error: null }
    );
    const supabase = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
      rpc,
    } as unknown as Parameters<typeof loadBoundAdminWalletGiglQuoteResponse>[0];

    const response = await loadBoundAdminWalletGiglQuoteResponse(
      supabase,
      'merchant-1',
      'quote-1'
    );

    await expect(response?.json()).resolves.toMatchObject({
      canBook: true,
      shortfall: 0,
      paidByBaci: true,
    });
    expect(rpc).not.toHaveBeenCalledWith(
      'get_merchant_shipping_wallet_balance',
      expect.anything()
    );
  });
});
