import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveQuoteMerchantContext } from './quote-merchant-context';

const mockCreateServerClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateServerClient,
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(),
  toUserAccess: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: vi.fn(),
}));

function createRequest(headers: Record<string, string>) {
  return {
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  };
}

describe('body-only storefront quote context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    '',
    'legacy-mobile',
    'mobile-storefront',
    'web-storefront',
  ] as const)('resolves the configured merchant origin for %s instead of defaulting to Lagos', async (client) => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        business_name: 'Abuja Store',
        business_address: '29 Yedseram Crescent, Maitama, 904101',
        phone: '08012345678',
        country: 'NG',
        state_code: 'FC',
      },
      error: null,
    });
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      rpc,
    });

    const result = await resolveQuoteMerchantContext({
      data: {
        merchantId: 'merchant-abuja',
        shipmentType: 'domestic',
      },
      request: createRequest({
        host: 'usebaci.com',
        'x-baci-client': client,
      }),
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
        from: vi.fn(),
      } as never,
    });

    expect(result).toEqual({
      ok: true,
      merchantId: 'merchant-abuja',
      senderInfo: expect.objectContaining({
        city: 'Maitama',
        state: 'Abuja',
        countryCode: 'NG',
      }),
      merchantCountry: 'NG',
      merchantPayoutCurrency: undefined,
    });
    expect(rpc).toHaveBeenCalledWith('get_storefront_shipping_sender', {
      p_merchant_id: 'merchant-abuja',
    });
  });

  it.each([
    '',
    'mobile-storefront',
  ])('ignores a caller-supplied sender for a body-only merchant quote with client %s', async (client) => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        business_name: 'Abuja Store',
        business_address: '29 Yedseram Crescent, Maitama, 904101',
        phone: '08012345678',
        country: 'NG',
        state_code: 'FC',
      },
      error: null,
    });
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      rpc,
    });

    const result = await resolveQuoteMerchantContext({
      data: {
        merchantId: 'merchant-abuja',
        shipmentType: 'domestic',
        sender: {
          name: 'Untrusted sender',
          phone: '08000000000',
          address: '1 Cheap Route',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
        },
      },
      request: createRequest({
        host: 'usebaci.com',
        'x-baci-client': client,
      }),
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
        from: vi.fn(),
      } as never,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        senderInfo: expect.objectContaining({
          address: '29 Yedseram Crescent, Maitama, 904101',
          city: 'Maitama',
          state: 'Abuja',
        }),
      })
    );
    expect(rpc).toHaveBeenCalledWith('get_storefront_shipping_sender', {
      p_merchant_id: 'merchant-abuja',
    });
  });

  it.each([
    '',
    'mobile-storefront',
  ])('fails closed when the body-only merchant has no published origin with client %s', async (client) => {
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    });

    await expect(
      resolveQuoteMerchantContext({
        data: { merchantId: 'merchant-missing', shipmentType: 'domestic' },
        request: createRequest({
          host: 'usebaci.com',
          'x-baci-client': client,
        }),
        supabase: {
          auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
          },
          from: vi.fn(),
        } as never,
      })
    ).resolves.toEqual({
      error: 'Merchant shipping origin is not configured',
      ok: false,
      status: 400,
    });
  });

  it.each([
    '',
    'mobile-storefront',
  ])('propagates a published non-Nigerian country for carrier suppression with client %s', async (client) => {
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      rpc: vi.fn().mockResolvedValue({
        data: {
          business_name: 'Bengaluru Store',
          business_address: '1 Market Road, Bengaluru',
          phone: '+919876543210',
          country: 'IN',
          state_code: null,
        },
        error: null,
      }),
    });

    await expect(
      resolveQuoteMerchantContext({
        data: {
          merchantId: 'merchant-in',
          shipmentType: 'domestic',
        },
        request: createRequest({
          host: 'usebaci.com',
          'x-baci-client': client,
        }),
        supabase: {
          auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
          },
          from: vi.fn(),
        } as never,
      })
    ).resolves.toEqual({
      ok: true,
      merchantId: 'merchant-in',
      senderInfo: expect.objectContaining({ countryCode: 'NG' }),
      merchantCountry: 'IN',
      merchantPayoutCurrency: undefined,
    });
  });
});
