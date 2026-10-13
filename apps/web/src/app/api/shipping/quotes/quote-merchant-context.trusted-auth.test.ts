import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveQuoteMerchantContext } from './quote-merchant-context';
import {
  createMerchantLookupClientMock,
  createRequest,
  createSupabase,
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

describe('resolveQuoteMerchantContext trusted auth', () => {
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

  it('prefers trusted storefront context over an ambient authenticated merchant session', async () => {
    const supabase = createSupabase();
    const merchantLookupClient = createMerchantLookupClientMock();
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'merchant-user' } },
          error: null,
        }),
      },
      ...merchantLookupClient,
    });

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
      }),
    });
  });

  it('replaces a caller-supplied domestic sender with the trusted storefront origin', async () => {
    const supabase = createSupabase();

    const result = await resolveQuoteMerchantContext({
      data: {
        shipmentType: 'domestic',
        sender: {
          name: 'Caller Origin',
          phone: '08000000000',
          address: '1 Cheaper Road',
          city: 'Abuja',
          state: 'FCT',
          country: 'Nigeria',
          countryCode: 'NG',
        },
      },
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
      }),
    });
  });

  it('uses trusted storefront context when an authenticated user lacks fulfillment permission', async () => {
    const supabase = createSupabase();
    const merchantLookupClient = createMerchantLookupClientMock();
    vi.mocked(hasPermission).mockReturnValue(false);
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'staff-user' } },
          error: null,
        }),
      },
      ...merchantLookupClient,
    });

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
      }),
    });
  });

  it('passes through the resolved merchant country on a trusted storefront subdomain', async () => {
    const supabase = createSupabase({ merchantCountry: 'IN' });
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
      ...createMerchantLookupClientMock({
        'merchant-1': {
          business_address: '1 Merchant Road, Ikeja, Lagos',
          business_name: 'Merchant Store',
          phone: '08012345678',
          country: 'IN',
        },
      }),
    });

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
      senderInfo: expect.objectContaining({
        name: 'Merchant Store',
        phone: '08012345678',
        city: 'Ikeja',
        countryCode: 'NG',
      }),
      merchantCountry: 'IN',
    });
  });

  it('passes through the merchant payout currency on a trusted storefront subdomain', async () => {
    const supabase = createSupabase({
      merchantCountry: 'NG',
      merchantPayoutCurrency: 'GHS',
    });
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
      ...createMerchantLookupClientMock({
        'merchant-1': {
          business_address: '1 Merchant Road, Ikeja, Lagos',
          business_name: 'Merchant Store',
          phone: '08012345678',
          country: 'NG',
          payout_currency: 'GHS',
        },
      }),
    });

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
      senderInfo: expect.objectContaining({
        name: 'Merchant Store',
        phone: '08012345678',
        city: 'Ikeja',
        countryCode: 'NG',
      }),
      merchantCountry: 'NG',
      merchantPayoutCurrency: 'GHS',
    });
  });
});
