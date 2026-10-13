import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getSupabaseServiceRoleKey: () => 's'.repeat(32),
}));

import { persistRefreshedShippingQuote } from './persist-refreshed-shipping-quote';

const checkoutQuote = {
  id: 'q1',
  provider: 'GIGL' as const,
  serviceTier: 'GoStandard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics',
  estimatedDays: 2,
  price: 11_000,
  currency: 'NGN',
  pickupIncluded: true,
  insuranceIncluded: false,
  expiresAt: new Date('2026-01-01'),
  rawResponse: { secret: 'never persisted' },
};

describe('persistRefreshedShippingQuote', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('writes every provider refresh through the authenticated order RPC', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: null }) };

    await expect(
      persistRefreshedShippingQuote(
        supabase as never,
        { ...checkoutQuote, id: 'q2', price: 12_000 },
        {
          merchantId: 'merchant-1',
          sessionId: 'order-1',
          orderId: 'order-1',
          quoteRequest: {
            sessionId: 'refresh-session',
            shipmentType: 'domestic',
            receiver: {
              name: 'Customer',
              phone: '08000000000',
              address: '1 Main Street',
              city: 'Lagos',
              state: 'Lagos',
              country: 'Nigeria',
              countryCode: 'NG',
            },
            items: [],
            admin_order_provenance: 'server_gigl_v1',
          },
        }
      )
    ).resolves.toEqual({ error: null });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_refreshed_order_shipping_quote',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_route_proof: expect.objectContaining({
          action: 'persist_refreshed_order_shipping_quote',
          subject_id: 'order-1',
        }),
      })
    );
  });

  it('does not expose an unscoped service-role fallback', async () => {
    const supabase = { rpc: vi.fn() };
    await expect(
      persistRefreshedShippingQuote(supabase as never, checkoutQuote, {
        merchantId: 'm1',
        sessionId: 's1',
        quoteRequest: {} as never,
      } as never)
    ).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('uses the same proof-bound RPC for TOPSHIP refreshes', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ error: null }) };
    await expect(
      persistRefreshedShippingQuote(
        supabase as never,
        { ...checkoutQuote, provider: 'TOPSHIP', id: 'topship-q' },
        {
          merchantId: 'merchant-1',
          sessionId: 'order-1',
          orderId: 'order-1',
          quoteRequest: {} as never,
        }
      )
    ).resolves.toEqual({ error: null });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_refreshed_order_shipping_quote',
      expect.objectContaining({ p_order_id: 'order-1' })
    );
  });
});
