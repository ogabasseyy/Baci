import type { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admin: { rpc: vi.fn() },
  public: { rpc: vi.fn() },
  rates: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mocks.admin,
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => mocks.public,
}));
vi.mock('@/lib/shipping', () => ({ shippingService: { getQuotes: vi.fn() } }));
vi.mock('./quote-merchant-context', () => ({
  resolveQuoteMerchantContext: async () => ({
    ok: true,
    merchantId: '10000000-0000-4000-8000-000000000001',
    merchantCountry: 'NG',
    merchantPayoutCurrency: 'NGN',
  }),
}));
vi.mock('./merchant-rate-quotes', () => ({
  getMerchantRateQuotes: mocks.rates,
}));
vi.mock('./resolve-quote-sender', () => ({
  resolveQuoteSender: () => ({ ok: true, sender: {} }),
}));
vi.mock('./quote-source-orchestration', async (original) => ({
  ...(await original<typeof import('./quote-source-orchestration')>()),
  orchestrateQuoteSources: async () => ({
    quotes: { all: [], featured: [] },
    sessionId: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
  }),
}));

import { POST } from './route';

describe('public merchant shipping rates client', () => {
  it('discovers pickup using anonymous-safe reads when the admin credential is unavailable', async () => {
    mocks.admin.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST301' },
    });
    mocks.rates.mockResolvedValue({ quotes: [] });
    const request = new Request('http://localhost/api/shipping/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shipmentType: 'domestic',
        merchantId: '10000000-0000-4000-8000-000000000001',
        supports_merchant_rates: true,
        receiver: {
          name: 'Test customer',
          address: '1 Test Street',
          city: 'Ikeja',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
        },
        items: [
          {
            name: 'Phone',
            quantity: 1,
            value: 198000,
            weight: 1,
            hsCode: '851712',
          },
        ],
      }),
    }) as unknown as NextRequest;
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.rates).toHaveBeenCalledWith(
      mocks.public,
      expect.objectContaining({
        merchantId: '10000000-0000-4000-8000-000000000001',
      })
    );
    expect(mocks.admin.rpc).not.toHaveBeenCalled();
  });
});
