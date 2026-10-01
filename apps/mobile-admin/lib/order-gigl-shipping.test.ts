import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/orders/authenticated-fetch', () => ({
  createAuthenticatedFetch: fetchMock,
}));
vi.mock('@/lib/api-client', () => ({ BASE_URL: 'https://example.test' }));

import {
  getMerchantWalletFundingAccount,
  getMerchantWalletSummary,
  getOrderGiglQuote,
  getOrRequestMerchantWalletFundingAccount,
  requestMerchantWalletFundingAccount,
} from './order-gigl-shipping';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

const quotePayload = {
  quote: {
    id: 'b2152ea0-831d-4387-b4c1-5dcf29a74c54',
    provider: 'GIGL',
    serviceTier: 'Express',
    carrierName: 'GIG Logistics',
    displayName: 'Door Delivery',
    estimatedDays: 2,
    price: 11000,
    currency: 'NGN',
    pickupIncluded: true,
    insuranceIncluded: false,
    expiresAt: '2026-09-01T18:00:00.000Z',
    providerCost: 10000,
    platformMargin: 1000,
  },
  availableBalance: 1000,
  shortfall: 10000,
  canBook: false,
};

describe('order GIG shipping API', () => {
  beforeEach(() => fetchMock.mockReset());

  it('validates and strips internal quote economics', async () => {
    fetchMock.mockResolvedValue(response(quotePayload));
    const result = await getOrderGiglQuote('order-1');
    expect(result.quote).toMatchObject({ provider: 'GIGL', price: 11000 });
    expect(result.quote).not.toHaveProperty('providerCost');
    expect(result.quote).not.toHaveProperty('platformMargin');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/api/orders/order-1/shipping/gigl-quote',
      expect.objectContaining({ method: 'POST' }),
      20_000
    );
  });

  it('sends only an authoritative receiver override and caller abort signal', async () => {
    fetchMock.mockResolvedValue(response(quotePayload));
    const controller = new AbortController();
    await getOrderGiglQuote(
      'order-1',
      { address: '1 Allen', city: 'Ikeja', state: 'Lagos', phone: '0801' },
      controller.signal
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          receiver: {
            address: '1 Allen',
            city: 'Ikeja',
            state: 'Lagos',
            phone: '0801',
          },
        }),
        signal: controller.signal,
      }),
      20_000
    );
  });

  it('posts paired coordinates for a coordinate-only Google address', async () => {
    fetchMock.mockResolvedValue(response(quotePayload));
    await getOrderGiglQuote('order-1', {
      address: 'Google place',
      phone: '0801',
      latitude: 6.6018,
      longitude: 3.3515,
    });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        receiver: {
          address: 'Google place',
          phone: '0801',
          latitude: 6.6018,
          longitude: 3.3515,
        },
      }),
    });
  });

  it('marks preview requests so the server can avoid quote mutation', async () => {
    fetchMock.mockResolvedValue(response(quotePayload));
    await getOrderGiglQuote(
      'order-1',
      {
        address: 'Google place',
        phone: '0801',
        latitude: 6.6,
        longitude: 3.35,
      },
      undefined,
      true
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        receiver: {
          address: 'Google place',
          phone: '0801',
          latitude: 6.6,
          longitude: 3.35,
        },
        preview: true,
      }),
    });
  });

  it('preserves server missing-field details on quote errors', async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
          error: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
          missing: ['city', 'state'],
        },
        422
      )
    );
    await expect(getOrderGiglQuote('order-1')).rejects.toMatchObject({
      code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
      missing: ['city', 'state'],
    });
  });

  it('rejects malformed success payloads', async () => {
    fetchMock.mockResolvedValue(response({ ...quotePayload, shortfall: -1 }));
    await expect(getOrderGiglQuote('order-1')).rejects.toThrow(
      'Invalid server response'
    );
  });

  it('loads and provisions funding accounts with explicit consent', async () => {
    const account = {
      accountName: 'BACI / Store',
      accountNumber: '1234567890',
      bankName: 'Wema Bank',
      currency: 'NGN',
      status: 'active',
    };
    fetchMock
      .mockResolvedValueOnce(response({ account: null }))
      .mockResolvedValueOnce(response({ account, status: 'active' }));
    await expect(getMerchantWalletFundingAccount()).resolves.toBeNull();
    await expect(requestMerchantWalletFundingAccount()).resolves.toMatchObject({
      account,
      status: 'active',
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ consent: true }),
      method: 'POST',
    });
  });

  it('reuses an active account without posting duplicate consent', async () => {
    const account = {
      accountName: 'BACI / Store',
      accountNumber: '1234567890',
      bankName: 'Wema Bank',
      currency: 'NGN',
      status: 'active',
    };
    fetchMock.mockResolvedValue(response({ account }));
    await expect(getOrRequestMerchantWalletFundingAccount()).resolves.toEqual({
      account,
      status: 'active',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });

  it('posts consent again when the funding account is still pending', async () => {
    const pending = {
      accountName: 'BACI / Store',
      accountNumber: '1234567890',
      bankName: 'Wema Bank',
      currency: 'NGN',
      status: 'pending',
    };
    const active = { ...pending, status: 'active' as const };
    fetchMock
      .mockResolvedValueOnce(response({ account: pending }))
      .mockResolvedValueOnce(response({ account: active, status: 'active' }));
    await expect(getOrRequestMerchantWalletFundingAccount()).resolves.toEqual({
      account: active,
      status: 'active',
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ consent: true }),
      method: 'POST',
    });
  });

  it('loads wallet balance for bounded transfer polling', async () => {
    fetchMock.mockResolvedValue(
      response({ availableBalance: 12500, currency: 'NGN' })
    );
    await expect(getMerchantWalletSummary()).resolves.toEqual({
      availableBalance: 12500,
      currency: 'NGN',
    });
  });
});
