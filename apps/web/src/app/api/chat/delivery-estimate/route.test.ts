import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: {},
  rates: vi.fn(),
  merchant: vi.fn(),
  loadRates: vi.fn(),
  buildResponse: vi.fn(),
  publicResponse: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => mocks.client,
}));
vi.mock('@/app/api/shipping/quotes/quote-merchant-context', () => ({
  resolveQuoteMerchantContext: mocks.merchant,
}));
vi.mock('@/app/api/shipping/quotes/load-public-merchant-rates', () => ({
  loadPublicMerchantRates: mocks.loadRates,
}));
vi.mock('@/app/api/shipping/quotes/quote-source-orchestration', () => ({
  buildMerchantOnlyQuoteResponse: mocks.buildResponse,
}));
vi.mock('@/app/api/shipping/quotes/public-quote-response', () => ({
  toPublicQuoteResponse: mocks.publicResponse,
}));

import { POST } from './route';

function request(body: unknown) {
  return new Request('https://store.usebaci.com/api/chat/delivery-estimate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'store.usebaci.com',
      'x-merchant-slug': 'store',
      'x-merchant-domain': 'store.usebaci.com',
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.merchant.mockResolvedValue({
    ok: true,
    merchantId: 'merchant-1',
    merchantCountry: 'NG',
    merchantPayoutCurrency: 'NGN',
  });
  mocks.loadRates.mockResolvedValue({ quotes: [{ id: 'merchant-rate' }] });
  mocks.buildResponse.mockReturnValue({
    quotes: { all: [{ id: 'merchant-rate' }], featured: [] },
  });
  mocks.publicResponse.mockImplementation((response) => response);
});

describe('POST /api/chat/delivery-estimate', () => {
  it('uses only a canonical confirmed state and never passes a subtotal or provider destination', async () => {
    const response = await POST(request({ state: 'Lagos' }));
    expect(response.status).toBe(200);
    expect(mocks.merchant).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { shipmentType: 'domestic' },
      })
    );
    expect(mocks.loadRates).toHaveBeenCalledWith('merchant-1', {
      receiverCountryCode: 'NG',
      receiverState: 'Lagos',
      merchantCurrency: 'NGN',
    });
    expect(JSON.stringify(mocks.loadRates.mock.calls)).not.toContain(
      'subtotal'
    );
  });

  it('rejects unrecognized states and extra address or merchant fields', async () => {
    expect(
      (await POST(request({ state: 'Lagos', address: 'Private Street' })))
        .status
    ).toBe(400);
    expect((await POST(request({ state: 'Atlantis' }))).status).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.loadRates).not.toHaveBeenCalled();
  });

  it('refuses non-Nigerian stores and returns service failure without exposing details', async () => {
    mocks.merchant.mockResolvedValueOnce({
      ok: true,
      merchantId: 'merchant-1',
      merchantCountry: 'IN',
      merchantPayoutCurrency: 'INR',
    });
    expect((await POST(request({ state: 'Lagos' }))).status).toBe(400);
    expect(mocks.loadRates).not.toHaveBeenCalled();

    mocks.merchant.mockResolvedValueOnce({
      ok: true,
      merchantId: 'merchant-1',
      merchantCountry: 'NG',
      merchantPayoutCurrency: 'NGN',
    });
    mocks.loadRates.mockResolvedValueOnce({ loadFailed: true, quotes: [] });
    const response = await POST(request({ state: 'Lagos' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Store delivery rates could not be loaded',
    });
  });
});
