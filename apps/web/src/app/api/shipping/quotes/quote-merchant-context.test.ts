import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveQuoteMerchantContext } from './quote-merchant-context';
import {
  createMerchantLookupClientMock,
  createRequest,
  createSupabase,
  callerSender as sender,
} from './quote-merchant-context.test-helpers';

const mockCreateServerClient = vi.hoisted(() => vi.fn());
const mockCreateScopedClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateServerClient,
}));

vi.mock('@/lib/supabase/scoped', () => ({
  createScopedClient: mockCreateScopedClient,
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(),
  toUserAccess: vi.fn((context: unknown) => context),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: vi.fn(() => true),
}));

const { getMerchantForApiRequest } = await import(
  '@/lib/get-merchant-for-api-request'
);
const { hasPermission } = await import('@/lib/api-auth');

describe('resolveQuoteMerchantContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMerchantForApiRequest).mockResolvedValue({
      merchantId: 'merchant-auth',
      staffAccess: {
        isOwner: true,
        isStaff: false,
        permissions: { full_access: { all: true } },
        role: null,
      },
    });
    vi.mocked(hasPermission).mockReturnValue(true);
    const merchantLookupClient = createMerchantLookupClientMock();
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
      ...merchantLookupClient,
    });
    mockCreateScopedClient.mockReturnValue(merchantLookupClient);
  });

  it('resolves sender details from a trusted storefront subdomain header', async () => {
    const supabase = createSupabase();

    const result = await resolveQuoteMerchantContext({
      data: { shipmentType: 'international' },
      request: createRequest({
        host: 'ogabassey.usebaci.com',
        'x-merchant-slug': 'ogabassey',
      }),
      supabase: supabase as never,
    });

    expect(result).toEqual({
      ok: true,
      merchantId: 'merchant-1',
      merchantCountry: 'NG',
      merchantPayoutCurrency: 'NGN',
      senderInfo: expect.objectContaining({
        name: 'Merchant Store',
        phone: '08012345678',
        city: 'Ikeja',
        countryCode: 'NG',
      }),
    });
    expect(supabase.from).toHaveBeenCalledWith('merchants');
  });

  it('resolves a renamed store via the retired-slug alias fallback when the old subdomain is still in use', async () => {
    const supabase = createSupabase({
      retiredSlug: 'yodhashop',
      retiredMerchantId: 'merchant-renamed',
    });

    const result = await resolveQuoteMerchantContext({
      data: { shipmentType: 'international' },
      request: createRequest({
        host: 'yodhashop.usebaci.com',
        'x-merchant-slug': 'yodhashop',
      }),
      supabase: supabase as never,
    });

    expect(result).toEqual({
      ok: true,
      merchantId: 'merchant-renamed',
      senderInfo: expect.objectContaining({
        name: 'Renamed Store',
        phone: '08055554444',
      }),
    });
    expect(supabase.from).toHaveBeenCalledWith('merchant_slug_aliases');
  });

  it('surfaces retired-slug alias lookup errors instead of silently dropping merchant context', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const supabase = createSupabase({
      retiredSlug: 'yodhashop',
      aliasLookupError: new Error('alias table down'),
    });

    const result = await resolveQuoteMerchantContext({
      data: {
        merchantId: 'merchant-body',
        shipmentType: 'international',
      },
      request: createRequest({
        host: 'yodhashop.usebaci.com',
        'x-merchant-slug': 'yodhashop',
      }),
      supabase: supabase as never,
    });

    expect(result).toEqual({
      error: 'Failed to resolve storefront merchant',
      ok: false,
      status: 500,
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Error resolving storefront merchant alias:',
      expect.any(Error)
    );

    consoleError.mockRestore();
  });

  it('does not trust spoofed storefront headers on the platform host', async () => {
    const supabase = createSupabase();
    const publicRpc = vi.fn().mockResolvedValue({
      data: {
        business_name: 'Body Merchant',
        business_address: '1 Allen Avenue, Ikeja, Lagos',
        country: 'NG',
      },
      error: null,
    });
    const anonymousFrom = vi.fn();
    mockCreateServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: anonymousFrom,
      rpc: publicRpc,
    });

    const result = await resolveQuoteMerchantContext({
      data: {
        merchantId: 'merchant-body',
        sender,
        shipmentType: 'domestic',
      },
      request: createRequest({
        host: 'usebaci.com',
        'x-merchant-slug': 'ogabassey',
      }),
      supabase: supabase as never,
    });

    expect(result).toEqual({
      ok: true,
      merchantId: 'merchant-body',
      senderInfo: expect.objectContaining({
        name: 'Body Merchant',
        city: 'Ikeja',
        state: 'Lagos',
      }),
      merchantCountry: 'NG',
      merchantPayoutCurrency: undefined,
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(anonymousFrom).not.toHaveBeenCalled();
    expect(publicRpc).toHaveBeenCalledWith('get_storefront_shipping_sender', {
      p_merchant_id: 'merchant-body',
    });
  });

  it('surfaces trusted storefront slug lookup errors instead of falling back to caller merchantId', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const supabase = createSupabase({
      slugLookupError: new Error('database unavailable'),
    });

    const result = await resolveQuoteMerchantContext({
      data: {
        merchantId: 'merchant-body',
        shipmentType: 'international',
      },
      request: createRequest({
        host: 'ogabassey.usebaci.com',
        'x-merchant-slug': 'ogabassey',
      }),
      supabase: supabase as never,
    });

    expect(result).toEqual({
      error: 'Failed to resolve storefront merchant',
      ok: false,
      status: 500,
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Error resolving storefront merchant slug:',
      expect.any(Error)
    );

    consoleError.mockRestore();
  });

  it('surfaces trusted storefront domain lookup errors instead of falling back to caller merchantId', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const supabase = createSupabase({
      domainLookupError: new Error('domain lookup failed'),
    });

    const result = await resolveQuoteMerchantContext({
      data: {
        merchantId: 'merchant-body',
        shipmentType: 'international',
      },
      request: createRequest({
        host: 'shop.example.com',
        'x-merchant-domain': 'shop.example.com',
      }),
      supabase: supabase as never,
    });

    expect(result).toEqual({
      error: 'Failed to resolve storefront merchant',
      ok: false,
      status: 500,
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Error resolving storefront merchant domain:',
      expect.any(Error)
    );

    consoleError.mockRestore();
  });
});
