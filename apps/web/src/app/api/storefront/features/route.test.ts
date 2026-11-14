import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const VALID_MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
const MISSING_MERCHANT_ID = '00000000-0000-4000-8000-000000000099';

const mockSingle = vi.fn();
const mockMerchantEq = vi.fn();
const mockMerchantSelect = vi.fn();
const mockFrom = vi.fn();
const mockCreateClient = vi.fn();
const mockLoggerError = vi.fn();
const mockGetCachedFeatureSettings = vi.fn();
const mockGetCachedMerchantPaystackSubaccount = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve(new Map())),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedFeatureSettings: (...args: unknown[]) =>
    mockGetCachedFeatureSettings(...args),
  getCachedMerchantPaystackSubaccountConfigured: (...args: unknown[]) =>
    mockGetCachedMerchantPaystackSubaccount(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

function buildMerchantRequest(query: string): NextRequest {
  return {
    nextUrl: new URL(`https://example.com/api/storefront/features?${query}`),
    get url() {
      throw new Error('request.url should not be read');
    },
  } as unknown as NextRequest;
}

describe('GET /api/storefront/features', () => {
  beforeEach(() => {
    mockSingle.mockReset();
    mockMerchantEq.mockReset();
    mockMerchantSelect.mockReset();
    mockFrom.mockReset();
    mockCreateClient.mockReset();
    mockLoggerError.mockReset();
    mockGetCachedFeatureSettings.mockReset();
    mockGetCachedMerchantPaystackSubaccount.mockReset();

    mockMerchantEq.mockReturnValue({ single: mockSingle });
    mockMerchantSelect.mockReturnValue({ eq: mockMerchantEq });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return { select: mockMerchantSelect };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    // Paystack subaccount presence (default: not configured)
    mockGetCachedMerchantPaystackSubaccount.mockResolvedValue(false);
    mockCreateClient.mockReturnValue({ from: mockFrom });
    mockGetCachedFeatureSettings.mockResolvedValue({});
  });

  it('does not advertise retired CredPal even if stored settings enable it', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'merchant-1', country: 'NG', business_type: 'fashion' },
      error: null,
    });
    mockGetCachedFeatureSettings.mockResolvedValueOnce({
      credpal_enabled: true,
      credit_direct_enabled: true,
    });
    const response = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    expect(await response.json()).toMatchObject({
      credpalEnabled: false,
      creditDirectEnabled: true,
    });
  });

  it('resolves the merchant via the RLS anon client and derives paystack from the bounded RPC', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'merchant-1', country: 'NG', business_type: 'fashion' },
      error: null,
    });
    mockGetCachedFeatureSettings.mockResolvedValueOnce({
      paystack_enabled: true,
      reviews_enabled: true,
      wishlist_enabled: true,
    });

    const response = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const body = (await response.json()) as {
      paystackEnabled: boolean;
      klumpEnabled: boolean;
      klumpMinAmount: number;
      klumpMaxAmount: number;
      reviewsEnabled: boolean;
    };

    expect(response.status).toBe(200);
    // Subaccount presence comes from the RPC (default: not configured), not a
    // raw merchants read — so paystack is disabled here.
    expect(body.paystackEnabled).toBe(false);
    expect(body.klumpEnabled).toBe(false);
    expect(body.klumpMinAmount).toBe(10000);
    expect(body.klumpMaxAmount).toBe(1000000);
    expect(body.reviewsEnabled).toBe(true);
    expect(mockGetCachedFeatureSettings).toHaveBeenCalledWith('merchant-1');
    // Regression guard: keep this public merchant projection exact and derive
    // the payment hint via the bounded RPC instead of selecting financial data.
    expect(mockMerchantSelect).toHaveBeenCalledWith(
      'id, country, business_type'
    );
    expect(mockGetCachedMerchantPaystackSubaccount).toHaveBeenCalledWith(
      'merchant-1'
    );
    expect(mockFrom).not.toHaveBeenCalledWith('merchant_feature_settings');
  });

  it('enables paystack when the bounded RPC reports a configured subaccount', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'merchant-1', country: 'NG', business_type: 'fashion' },
      error: null,
    });
    mockGetCachedFeatureSettings.mockResolvedValueOnce({
      paystack_enabled: true,
    });
    mockGetCachedMerchantPaystackSubaccount.mockResolvedValueOnce(true);

    const response = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const body = (await response.json()) as { paystackEnabled: boolean };

    expect(response.status).toBe(200);
    expect(body.paystackEnabled).toBe(true);
  });

  it('fails closed (200 with Paystack disabled) when the subaccount RPC errors', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'merchant-1', country: 'NG', business_type: 'fashion' },
      error: null,
    });
    // Feature flag ON — proving the RPC error still fails closed.
    mockGetCachedFeatureSettings.mockResolvedValueOnce({
      paystack_enabled: true,
    });
    mockGetCachedMerchantPaystackSubaccount.mockRejectedValueOnce(
      new Error('rpc timeout')
    );

    const response = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const body = (await response.json()) as { paystackEnabled: boolean };

    expect(response.status).toBe(200);
    // Fail closed: an unverifiable subaccount must not advertise Paystack, even
    // with the feature flag enabled (the checkout client defaults to Paystack on
    // a non-ok response, so a 500 would expose it).
    expect(body.paystackEnabled).toBe(false);
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('returns default features with paystack disabled when merchant has no subaccount', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'merchant-1', paystack_subaccount_code: null },
      error: null,
    });
    mockGetCachedFeatureSettings.mockResolvedValueOnce({});

    const response = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const body = (await response.json()) as {
      paystackEnabled: boolean;
      klumpEnabled: boolean;
      klumpMinAmount: number;
      klumpMaxAmount: number;
      reviewsEnabled: boolean;
      wishlistEnabled: boolean;
      repairsCatalogEnabled: boolean;
    };

    expect(response.status).toBe(200);
    expect(body.paystackEnabled).toBe(false);
    expect(body.klumpEnabled).toBe(false);
    expect(body.klumpMinAmount).toBe(10000);
    expect(body.klumpMaxAmount).toBe(1000000);
    expect(body.reviewsEnabled).toBe(true);
    expect(body.wishlistEnabled).toBe(true);
    expect(body.repairsCatalogEnabled).toBe(false);
  });

  it('defaults korapay OFF when the flag is absent, and honours an explicit true', async () => {
    // Absent flag → opt-in default OFF (must not advertise Korapay at checkout).
    mockSingle.mockResolvedValueOnce({
      data: { id: 'merchant-1', paystack_subaccount_code: null },
      error: null,
    });
    mockGetCachedFeatureSettings.mockResolvedValueOnce({});

    const absentResponse = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const absentBody = (await absentResponse.json()) as {
      korapayEnabled: boolean;
    };
    expect(absentResponse.status).toBe(200);
    expect(absentBody.korapayEnabled).toBe(false);

    // Explicit opt-in still works.
    mockSingle.mockResolvedValueOnce({
      data: { id: 'merchant-1', paystack_subaccount_code: null },
      error: null,
    });
    mockGetCachedFeatureSettings.mockResolvedValueOnce({
      korapay_enabled: true,
    });

    const enabledResponse = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const enabledBody = (await enabledResponse.json()) as {
      korapayEnabled: boolean;
    };
    expect(enabledResponse.status).toBe(200);
    expect(enabledBody.korapayEnabled).toBe(true);
  });

  it('preserves an explicit empty checkout add-on amount list', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'merchant-1', paystack_subaccount_code: null },
      error: null,
    });
    mockGetCachedFeatureSettings.mockResolvedValueOnce({
      vtu_checkout_addon_amounts: [],
    });

    const response = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const body = (await response.json()) as {
      vtuCheckoutAddonAmounts: number[];
    };

    expect(response.status).toBe(200);
    expect(body.vtuCheckoutAddonAmounts).toEqual([]);
  });

  it('returns merchant Klump installment settings in the public feature payload', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'merchant-1',
        business_type: 'electronics',
        paystack_subaccount_code: 'ACCT_123',
      },
      error: null,
    });
    mockGetCachedFeatureSettings.mockResolvedValueOnce({
      paystack_enabled: true,
      klump_enabled: true,
      klump_min_amount: 2500,
      klump_max_amount: 750000,
    });

    const response = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const body = (await response.json()) as {
      klumpEnabled: boolean;
      klumpMinAmount: number;
      klumpMaxAmount: number;
    };

    expect(response.status).toBe(200);
    expect(body.klumpEnabled).toBe(true);
    expect(body.klumpMinAmount).toBe(2500);
    expect(body.klumpMaxAmount).toBe(750000);
  });

  it('surfaces the repairs catalogue flag when enabled', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'merchant-1',
        business_type: 'electronics',
        paystack_subaccount_code: 'ACCT_123',
      },
      error: null,
    });
    mockGetCachedFeatureSettings.mockResolvedValueOnce({
      repairs_catalog_enabled: true,
    });

    const response = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const body = (await response.json()) as { repairsCatalogEnabled: boolean };

    expect(response.status).toBe(200);
    expect(body.repairsCatalogEnabled).toBe(true);
  });

  it('hides the repairs catalogue flag for non-repairs business types', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'merchant-1',
        business_type: 'fashion',
        paystack_subaccount_code: 'ACCT_123',
      },
      error: null,
    });
    mockGetCachedFeatureSettings.mockResolvedValueOnce({
      repairs_catalog_enabled: true,
    });

    const response = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const body = (await response.json()) as { repairsCatalogEnabled: boolean };

    expect(response.status).toBe(200);
    expect(body.repairsCatalogEnabled).toBe(false);
  });

  it('returns 400 when neither merchantId nor slug is provided', async () => {
    const request = {
      nextUrl: new URL('https://example.com/api/storefront/features'),
    } as unknown as NextRequest;

    const response = await GET(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('merchantId or slug is required');
  });

  it('returns 404 when the merchant does not exist', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    const response = await GET(
      buildMerchantRequest(`merchantId=${MISSING_MERCHANT_ID}`)
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Store not found');
    expect(mockGetCachedFeatureSettings).not.toHaveBeenCalled();
  });

  it('returns 400 when merchantId is not a valid UUID', async () => {
    const request = {
      nextUrl: new URL(
        'https://example.com/api/storefront/features?merchantId=not-a-uuid'
      ),
    } as unknown as NextRequest;

    const response = await GET(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid merchantId');
  });

  it('returns 500 when the merchant lookup fails', async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    });

    const response = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe('Internal server error');
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Storefront features merchant lookup failed',
      })
    );
  });

  it('returns 500 when the feature settings projection fails', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'merchant-1', paystack_subaccount_code: 'ACCT_123' },
      error: null,
    });
    mockGetCachedFeatureSettings.mockRejectedValueOnce(
      new Error('statement timeout')
    );

    const response = await GET(
      buildMerchantRequest(`merchantId=${VALID_MERCHANT_ID}`)
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe('Internal server error');
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Storefront features GET error',
      })
    );
  });
});
