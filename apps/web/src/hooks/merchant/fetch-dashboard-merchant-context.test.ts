import { describe, expect, it, vi } from 'vitest';
import { fetchDashboardMerchantContext } from './fetch-dashboard-merchant-context';

describe('fetchDashboardMerchantContext', () => {
  it('returns the caller-bound RPC context', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        merchant: { id: 'merchant-1', business_name: 'Baci Store' },
        primaryDomain: { domain: 'shop.example.com' },
        staffAccess: {
          isStaff: false,
          isOwner: true,
          role: null,
          permissions: { full_access: { all: true } },
        },
      },
      error: null,
    });

    const result = await fetchDashboardMerchantContext({ rpc } as never);

    expect(rpc).toHaveBeenCalledWith('get_user_merchant_context');
    expect(result.merchant?.id).toBe('merchant-1');
    expect(result.primaryDomain).toBe('shop.example.com');
    expect(result.staffAccess.isOwner).toBe(true);
  });

  it('returns an empty context when the RPC finds no merchant', async () => {
    const result = await fetchDashboardMerchantContext({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as never);

    expect(result).toEqual({
      merchant: null,
      primaryDomain: null,
      staffAccess: {
        isStaff: false,
        isOwner: false,
        role: null,
        permissions: {},
      },
    });
  });

  it('throws database errors', async () => {
    const error = new Error('RPC failed');

    await expect(
      fetchDashboardMerchantContext({
        rpc: vi.fn().mockResolvedValue({ data: null, error }),
      } as never)
    ).rejects.toBe(error);
  });

  it('rejects malformed RPC payloads', async () => {
    await expect(
      fetchDashboardMerchantContext({
        rpc: vi.fn().mockResolvedValue({
          data: { merchant: {}, primaryDomain: null },
          error: null,
        }),
      } as never)
    ).rejects.toThrow('Invalid dashboard merchant context');
  });
});

it('never serializes legacy or nested provider credentials from caller-bound context', async () => {
  const result = await fetchDashboardMerchantContext({
    rpc: vi.fn().mockResolvedValue({
      error: null,
      data: {
        merchant: {
          id: 'own',
          facebook_capi_token: 'legacy-private',
          feature_settings: {
            facebook_capi_token: 'nested-private',
            ga4_api_secret: 'ga-private',
            reviews_enabled: true,
          },
        },
        primaryDomain: null,
        staffAccess: {
          isStaff: false,
          isOwner: true,
          role: null,
          permissions: {},
        },
      },
    }),
  } as never);
  expect(JSON.stringify(result)).not.toMatch(
    /legacy-private|nested-private|ga-private/
  );
  expect(result.merchant?.feature_settings).toMatchObject({
    facebook_capi_token: null,
    facebook_capi_token_configured: true,
    ga4_api_secret_configured: true,
    reviews_enabled: true,
  });
});
