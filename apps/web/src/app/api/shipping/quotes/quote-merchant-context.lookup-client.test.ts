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

describe('resolveQuoteMerchantContext lookup client', () => {
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

  it('loads trusted sender details through the cookie-backed server lookup client', async () => {
    const adminSupabase = createSupabase();
    const scopedMerchantFrom = vi.fn((table: string) => {
      const filters: Record<string, string> = {};
      const query = {
        eq: vi.fn((column: string, value: string) => {
          filters[column] = value;
          return query;
        }),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data:
              table === 'merchants' && filters.id === 'merchant-1'
                ? {
                    business_address: '29 Yedseram Crescent, Maitama, 904101',
                    business_name: 'Scoped Merchant Store',
                    phone: '08012345678',
                    country: 'NG',
                    payout_currency: 'NGN',
                    state_code: null,
                  }
                : null,
            error: null,
          })
        ),
      };
      return { select: vi.fn(() => query) };
    });
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
      from: scopedMerchantFrom,
    });

    const result = await resolveQuoteMerchantContext({
      data: { shipmentType: 'domestic' },
      request: createRequest({
        host: 'ogabassey.usebaci.com',
        'x-merchant-slug': 'ogabassey',
      }),
      supabase: adminSupabase as never,
    });

    expect(result).toEqual({
      ok: true,
      merchantId: 'merchant-1',
      merchantCountry: 'NG',
      merchantPayoutCurrency: 'NGN',
      senderInfo: expect.objectContaining({
        name: 'Scoped Merchant Store',
        city: 'Maitama',
        state: 'Abuja',
      }),
    });
    expect(scopedMerchantFrom).toHaveBeenCalledWith('merchants');
    expect(mockCreateScopedClient).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(adminSupabase.from)
        .mock.calls.filter(([table]) => table === 'merchants')
    ).toHaveLength(1);
  });

  describe('bugfix: invalid Bearer on trusted storefront', () => {
    it('falls back to the anonymous cookie client instead of installing a stale Bearer token', async () => {
      const adminSupabase = createSupabase();
      vi.mocked(adminSupabase.auth.getUser).mockResolvedValue({
        data: { user: null },
        error: { message: 'JWT expired', name: 'AuthApiError', status: 401 },
      } as never);

      const selectedColumns: string[] = [];
      const anonymousMerchantFrom = vi.fn((table: string) => {
        const filters: Record<string, string> = {};
        const query = {
          eq: vi.fn((column: string, value: string) => {
            filters[column] = value;
            return query;
          }),
          maybeSingle: vi.fn(() =>
            Promise.resolve({
              data:
                table === 'merchants' && filters.id === 'merchant-1'
                  ? {
                      business_address: '29 Yedseram Crescent, Maitama, 904101',
                      business_name: 'Anon Storefront Merchant',
                      phone: '08012345678',
                      country: 'NG',
                      payout_currency: 'NGN',
                    }
                  : null,
              error: null,
            })
          ),
        };
        return {
          select: vi.fn((columns: string) => {
            selectedColumns.push(columns);
            return query;
          }),
        };
      });

      mockCreateServerClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: null,
          }),
        },
        from: anonymousMerchantFrom,
      });

      const result = await resolveQuoteMerchantContext({
        data: { shipmentType: 'domestic' },
        request: createRequest({
          host: 'ogabassey.usebaci.com',
          'x-merchant-slug': 'ogabassey',
          authorization: 'Bearer stale-or-expired-token',
        }),
        supabase: adminSupabase as never,
      });

      expect(result).toEqual({
        ok: true,
        merchantId: 'merchant-1',
        merchantCountry: 'NG',
        merchantPayoutCurrency: 'NGN',
        senderInfo: expect.objectContaining({
          name: 'Anon Storefront Merchant',
          city: 'Maitama',
          state: 'Abuja',
        }),
      });
      expect(mockCreateScopedClient).not.toHaveBeenCalled();
      expect(mockCreateServerClient).toHaveBeenCalled();
      expect(anonymousMerchantFrom).toHaveBeenCalledWith('merchants');
      expect(selectedColumns.length).toBeGreaterThan(0);
      for (const columns of selectedColumns) {
        expect(columns).not.toContain('registered_address');
        expect(columns).not.toContain('state_code');
      }
    });
  });
});
