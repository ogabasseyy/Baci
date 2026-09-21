import { cacheLife, cacheTag } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCachedDataTestHarness,
  type CachedDataTestHarness,
  mockMerchant,
  resolvedStorefrontMerchantRpcResult,
} from '@/lib/cached-data.test-utils';

const mockCreateClient = vi.fn();

vi.mock('@/env', () => ({
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'test-anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'test-service-role-key'),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/merchant-lookup-backoff', () => ({
  waitForMerchantLookupRetryBackoff: vi.fn(() => Promise.resolve()),
}));
vi.mock('react', () => ({ cache: vi.fn((fn: unknown) => fn) }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import {
  getCachedCategories,
  getCachedFeatureSettings,
  getCachedMerchant,
  getCachedMerchantByDomain,
  getCachedMerchantById,
  getCachedMerchantPaystackSubaccountConfigured,
  getCachedProductRatingStats,
  getCachedProductReviews,
  getCachedProducts,
  getCachedStorefrontHomeProducts,
  getCachedStorefrontLaunchProducts,
  getPublicSupabaseClient,
  getStorefrontCategories,
} from '@/lib/cached-data';

let harness: CachedDataTestHarness;

const _DEFAULT_DISABLED_SETTINGS = {
  blog_enabled: false,
  shipping_insurance_enabled: false,
  shipping_insurance_min_order_value: 5000,
  shipping_insurance_opt_in_default: false,
};

describe('getPublicSupabaseClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockReturnValue({ from: vi.fn() });
  });

  it('creates a Supabase client with correct URL and key', () => {
    getPublicSupabaseClient();

    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'test-anon-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          persistSession: false,
          autoRefreshToken: false,
        }),
      })
    );
  });

  it('throws when Supabase URL is missing', () => {
    vi.mocked(getSupabaseUrl).mockReturnValueOnce('');

    expect(() => getPublicSupabaseClient()).toThrow(
      'Supabase configuration is missing'
    );
  });

  it('throws when Supabase anon key is missing', () => {
    vi.mocked(getSupabaseAnonKey).mockReturnValueOnce('');

    expect(() => getPublicSupabaseClient()).toThrow(
      'Supabase configuration is missing'
    );
  });
});

describe('getCachedCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness = buildCachedDataTestHarness();
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
      auth: { getUser: vi.fn() },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns categories on success', async () => {
    const categories = [
      { id: 'c1', name: 'Electronics', slug: 'electronics' },
      { id: 'c2', name: 'Fashion', slug: 'fashion' },
    ];

    harness.mockListResult.data = categories;
    harness.mockListResult.error = null;

    const result = await getCachedCategories('merchant-1');

    expect(result).toEqual(categories);
    expect(harness.mockEq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(harness.mockOrder).toHaveBeenCalledWith('name', { ascending: true });
  });

  it('throws on error so a transient category failure cannot be cached as empty', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    harness.mockListResult.data = null;
    harness.mockListResult.error = { message: 'DB timeout' };

    await expect(getCachedCategories('merchant-1')).rejects.toEqual({
      message: 'DB timeout',
    });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('returns empty array when data is null', async () => {
    harness.mockListResult.data = null;
    harness.mockListResult.error = null;

    const result = await getCachedCategories('merchant-1');

    expect(result).toEqual([]);
  });

  it('degrades a transient optional-navigation failure outside the cached fill', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    harness.mockListResult.data = null;
    harness.mockListResult.error = { message: 'DB timeout' };

    await expect(getStorefrontCategories('merchant-1')).resolves.toEqual({
      categories: [],
      queryFailed: true,
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      'Category navigation query failed outside cache:',
      expect.objectContaining({ merchantId: 'merchant-1' })
    );
  });

  it('reports a successful optional-navigation read without changing its rows', async () => {
    const categories = [{ id: 'c1', name: 'Electronics', slug: 'electronics' }];
    harness.mockListResult.data = categories;
    harness.mockListResult.error = null;

    await expect(getStorefrontCategories('merchant-1')).resolves.toEqual({
      categories,
      queryFailed: false,
    });
  });
});

describe('cached merchant entity normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness = buildCachedDataTestHarness();
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
      auth: { getUser: vi.fn() },
    });
  });

  it('normalizes the OgaBassey slug merchant away from stale fashion business type', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedStorefrontMerchantRpcResult(
        {
          ...mockMerchant,
          business_type: 'fashion',
          slug: 'ogabassey',
        },
        { customDomain: 'ogabassey.com' }
      )
    );

    const merchant = await getCachedMerchant('ogabassey');

    expect(cacheTag).toHaveBeenCalledWith(`features-${mockMerchant.id}`);
    expect(merchant).toEqual(
      expect.objectContaining({
        business_type: 'electronics',
        custom_domain: 'ogabassey.com',
        slug: 'ogabassey',
      })
    );
  });

  it('accepts the minimized unpublished snapshot used by the coming-soon shell', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedStorefrontMerchantRpcResult({
        id: 'merchant-unpublished',
        business_name: 'Coming Soon Store',
        slug: 'coming-soon-store',
        is_published: false,
      })
    );

    const merchant = await getCachedMerchant('coming-soon-store');

    expect(merchant).toEqual(
      expect.objectContaining({
        id: 'merchant-unpublished',
        business_name: 'Coming Soon Store',
        business_type: 'general',
        slug: 'coming-soon-store',
        is_published: false,
        email: '',
        phone: '',
      })
    );
    expect(merchant?.feature_settings).toBeDefined();
    expect(merchant).not.toHaveProperty('published_config');
    expect(merchant).not.toHaveProperty('paystack_subaccount_code');
  });

  it('lets the SDK-owned GET retry policy operate under one total deadline', async () => {
    harness.mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23',
        message: 'TimeoutError: The operation was aborted due to timeout',
      },
    });

    await expect(getCachedMerchant('test-store')).rejects.toBeInstanceOf(Error);
    expect(harness.mockRpc).toHaveBeenCalledTimes(1);
  });

  it('normalizes the OgaBassey domain merchant away from stale fashion business type', async () => {
    harness.mockRpc.mockResolvedValueOnce({
      data: [
        {
          resolution_status: 'found',
          custom_domain: 'ogabassey.com',
          feature_settings: null,
          merchant_data: {
            ...mockMerchant,
            business_type: 'fashion',
            slug: 'ogabassey',
          },
        },
      ],
      error: null,
    });

    const merchant = await getCachedMerchantByDomain('ogabassey.com');

    expect(harness.mockRpc).toHaveBeenCalledWith(
      'resolve_storefront_public_snapshot_v2',
      {
        p_identifier: 'ogabassey.com',
      },
      { get: true }
    );
    expect(harness.mockFrom).not.toHaveBeenCalledWith('domains');
    expect(merchant).toEqual(
      expect.objectContaining({
        business_type: 'electronics',
        custom_domain: 'ogabassey.com',
        slug: 'ogabassey',
      })
    );
  });

  it('uses the merchant resolver RPC for domain lookups to avoid serial PostgREST reads', async () => {
    harness.mockRpc.mockResolvedValueOnce({
      data: [
        {
          resolution_status: 'found',
          custom_domain: 'fashion.example',
          feature_settings: { blog_enabled: true },
          merchant_data: {
            ...mockMerchant,
            business_type: 'fashion',
            slug: 'fashion-store',
          },
        },
      ],
      error: null,
    });

    const merchant = await getCachedMerchantByDomain('fashion.example');

    expect(cacheTag).toHaveBeenCalledWith(`features-${mockMerchant.id}`);
    expect(harness.mockRpc).toHaveBeenCalledWith(
      'resolve_storefront_public_snapshot_v2',
      {
        p_identifier: 'fashion.example',
      },
      { get: true }
    );
    expect(harness.mockFrom).not.toHaveBeenCalledWith('domains');
    expect(merchant).toEqual(
      expect.objectContaining({
        business_type: 'fashion',
        custom_domain: 'fashion.example',
        feature_settings: expect.objectContaining({ blog_enabled: true }),
        slug: 'fashion-store',
      })
    );
  });

  it('passes repairs_catalog_enabled from the snapshot through the normalizer untouched', async () => {
    // The public repairs catalogue (repair pages, PDP repair link, repairs
    // sitemap) gates on this flag; the snapshot normalizer must not strip it
    // once the RPC allowlist (20260712100000) projects it.
    harness.mockRpc.mockResolvedValueOnce({
      data: [
        {
          resolution_status: 'found',
          custom_domain: 'fashion.example',
          feature_settings: {
            blog_enabled: true,
            repairs_catalog_enabled: true,
          },
          merchant_data: { ...mockMerchant, slug: 'fashion-store' },
        },
      ],
      error: null,
    });

    const merchant = await getCachedMerchantByDomain('fashion.example');

    expect(merchant?.feature_settings).toEqual(
      expect.objectContaining({ repairs_catalog_enabled: true })
    );
  });

  it('returns null when the storefront merchant resolver has no domain match', async () => {
    harness.mockRpc.mockResolvedValueOnce({
      data: [
        {
          resolution_status: 'not_found',
          merchant_data: null,
          custom_domain: null,
          feature_settings: null,
        },
      ],
      error: null,
      status: 200,
    });

    const merchant = await getCachedMerchantByDomain('missing.example');

    expect(merchant).toBeNull();
  });

  it('sanitizes the host-derived domain in merchant lookup logs', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    harness.mockRpc.mockRejectedValueOnce(new Error('application failure'));

    await expect(
      getCachedMerchantByDomain('EXAMPLE.COM\r\nforged-entry')
    ).rejects.toThrow('application failure');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error resolving merchant for domain',
      expect.objectContaining({ domain: 'example.comforged-entry' })
    );
  });

  it('throws without converting transient domain lookup errors to absence', async () => {
    const timeoutResult = {
      data: null,
      error: {
        message: 'TimeoutError: The operation was aborted due to timeout',
      },
    };
    harness.mockRpc.mockResolvedValueOnce(timeoutResult);

    await expect(
      getCachedMerchantByDomain('ogabassey.com')
    ).rejects.toBeInstanceOf(Error);
  });

  it('normalizes OgaBassey merchant lookup by id when the slug is available', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        ...mockMerchant,
        business_type: 'fashion',
        slug: 'ogabassey',
      },
      error: null,
      count: null,
    });

    const merchant = await getCachedMerchantById(mockMerchant.id);

    expect(merchant).toEqual(
      expect.objectContaining({
        business_type: 'electronics',
        slug: 'ogabassey',
      })
    );
  });

  it('preserves business type for non-OgaBassey slug merchants', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedStorefrontMerchantRpcResult(
        {
          ...mockMerchant,
          business_type: 'fashion',
          slug: 'fashionstore',
        },
        { customDomain: 'fashion.example' }
      )
    );

    const merchant = await getCachedMerchant('fashionstore');

    expect(merchant).toEqual(
      expect.objectContaining({
        business_type: 'fashion',
        custom_domain: 'fashion.example',
        slug: 'fashionstore',
      })
    );
  });

  it('preserves business type for non-OgaBassey domain merchants', async () => {
    harness.mockRpc.mockResolvedValueOnce({
      data: [
        {
          resolution_status: 'found',
          custom_domain: 'fashion.example',
          feature_settings: null,
          merchant_data: {
            ...mockMerchant,
            business_type: 'fashion',
            slug: 'fashionstore',
          },
        },
      ],
      error: null,
    });

    const merchant = await getCachedMerchantByDomain('fashion.example');

    expect(merchant).toEqual(
      expect.objectContaining({
        business_type: 'fashion',
        custom_domain: 'fashion.example',
        slug: 'fashionstore',
      })
    );
  });

  it('preserves business type for non-OgaBassey merchant lookup by id', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        ...mockMerchant,
        business_type: 'fashion',
        slug: 'fashionstore',
      },
      error: null,
      count: null,
    });

    const merchant = await getCachedMerchantById(mockMerchant.id);

    expect(merchant).toEqual(
      expect.objectContaining({
        business_type: 'fashion',
        slug: 'fashionstore',
      })
    );
  });

  it('throws on a transient id lookup error so it is never cached as absence', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    harness.mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: '57014', message: 'canceling statement due to timeout' },
      count: null,
    });

    await expect(getCachedMerchantById(mockMerchant.id)).rejects.toEqual({
      code: '57014',
      message: 'canceling statement due to timeout',
    });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('returns null for a genuinely absent merchant (PGRST116 no rows)', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
      count: null,
    });

    await expect(getCachedMerchantById('missing-merchant')).resolves.toBeNull();
  });
});

describe('getCachedFeatureSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness = buildCachedDataTestHarness();
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
      auth: { getUser: vi.fn() },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns feature settings from database on success', async () => {
    const settings = {
      blog_enabled: true,
      blog_discover_image_validation_enabled: true,
      repairs_catalog_enabled: false,
      shipping_insurance_enabled: true,
      shipping_insurance_min_order_value: 10000,
      shipping_insurance_opt_in_default: true,
    };

    harness.mockMaybeSingle.mockResolvedValueOnce({
      data: settings,
      error: null,
      count: null,
    });

    const result = await getCachedFeatureSettings('merchant-1');

    expect(result).toEqual(settings);
    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'test-anon-key',
      expect.any(Object)
    );
    const projection = String(harness.mockSelect.mock.calls[0]?.[0] ?? '');
    expect(projection).toContain('blog_enabled');
    expect(projection).toContain('blog_discover_image_validation_enabled');
    expect(projection).toContain('repairs_catalog_enabled');
    expect(projection).toContain('shipping_insurance_enabled');
    expect(projection).toContain('shipping_insurance_min_order_value');
    expect(projection).toContain('shipping_insurance_opt_in_default');
    expect(projection).toContain('facebook_pixel_id');
    expect(projection).toContain('custom_settings');
    expect(projection).not.toContain('facebook_capi_token');
    expect(projection).not.toContain('tiktok_access_token');
    expect(projection).not.toContain('ga4_api_secret');
    expect(projection).not.toContain('snapchat_capi_token');
  });

  it('throws on Supabase error instead of returning defaults', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    harness.mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found', code: 'PGRST116' },
      count: null,
    });

    await expect(getCachedFeatureSettings('merchant-1')).rejects.toMatchObject({
      message: 'Not found',
    });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('throws when Supabase client creation fails', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockCreateClient.mockImplementation(() => {
      throw new Error('Missing public client configuration');
    });

    await expect(getCachedFeatureSettings('merchant-1')).rejects.toThrow(
      'Missing public client configuration'
    );
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('returns public defaults when no settings row exists', async () => {
    harness.mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
      count: null,
    });

    const result = await getCachedFeatureSettings('merchant-1');

    expect(result).toMatchObject({
      merchant_id: 'merchant-1',
      paystack_enabled: true,
      // Korapay is opt-in (default OFF) when no settings row exists.
      korapay_enabled: false,
      preferred_local_gateway: 'paystack',
      preferred_international_gateway: 'korapay',
    });
    expect(result).not.toHaveProperty('facebook_capi_token');
    expect(result).not.toHaveProperty('ga4_api_secret');
  });
});

describe('getCachedMerchantPaystackSubaccountConfigured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness = buildCachedDataTestHarness();
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
      auth: { getUser: vi.fn() },
    });
  });

  it('calls the bounded storefront RPC with the anonymous client', async () => {
    harness.mockRpc.mockResolvedValueOnce({
      data: true,
      error: null,
      count: null,
    });

    await expect(
      getCachedMerchantPaystackSubaccountConfigured('merchant-1')
    ).resolves.toBe(true);

    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'test-anon-key',
      expect.any(Object)
    );
    expect(harness.mockRpc).toHaveBeenCalledWith(
      'storefront_merchant_has_paystack_subaccount',
      { p_merchant_id: 'merchant-1' }
    );
  });

  it('rethrows RPC errors instead of caching a false result', async () => {
    const rpcError = { code: 'PGRST000', message: 'RPC unavailable' };
    harness.mockRpc.mockResolvedValueOnce({
      data: null,
      error: rpcError,
      count: null,
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      getCachedMerchantPaystackSubaccountConfigured('merchant-1')
    ).rejects.toEqual(rpcError);
  });
});

describe('getCachedProductReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness = buildCachedDataTestHarness();
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
      auth: { getUser: vi.fn() },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries live review columns through the aliases used by the PDP', async () => {
    const review = {
      id: 'review-1',
      rating: 5,
      review_title: 'Excellent',
      review_text: 'Fast delivery and clean device.',
      reviewer_name: 'Ada',
      is_verified_purchase: true,
      helpful_count: 4,
      created_at: '2026-07-04T10:00:00Z',
      merchant_response: 'Thank you.',
      response_at: '2026-07-04T11:00:00Z',
    };
    harness.mockListResult.data = [review];
    harness.mockListResult.error = null;

    const result = await getCachedProductReviews('product-1', { limit: 10 });

    expect(result).toEqual([review]);
    const selectColumns = String(harness.mockSelect.mock.calls[0]?.[0] ?? '');
    expect(selectColumns).toContain('review_title:title');
    expect(selectColumns).toContain('review_text:body');
    expect(selectColumns).toContain('reviewer_name:customer_name');
    expect(selectColumns).toContain('is_verified_purchase:verified_purchase');
    expect(selectColumns).toContain('response_at:merchant_response_at');
    expect(selectColumns).not.toContain('\n        review_title,');
    expect(harness.mockEq).toHaveBeenCalledWith('product_id', 'product-1');
    expect(harness.mockLimit).toHaveBeenCalledWith(10);
  });

  it('keeps a review failure request-local and retries the cached read later', async () => {
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const error = { message: 'query failed' };
    harness.mockListResult.data = null;
    harness.mockListResult.error = error;

    await expect(getCachedProductReviews('product-1')).resolves.toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Optional PDP reviews unavailable',
      { productId: 'product-1', error }
    );

    const recoveredReview = { id: 'review-2', rating: 5 };
    harness.mockListResult.data = [recoveredReview];
    harness.mockListResult.error = null;
    await expect(getCachedProductReviews('product-1')).resolves.toEqual([
      recoveredReview,
    ]);
    expect(cacheLife).toHaveBeenCalledWith('products');
  });
});

describe('getCachedProductRatingStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness = buildCachedDataTestHarness();
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
      auth: { getUser: vi.fn() },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns correct stats for a set of reviews', async () => {
    const reviews = [
      { rating: 5 },
      { rating: 5 },
      { rating: 4 },
      { rating: 3 },
      { rating: 1 },
    ];

    harness.mockListResult.data = reviews;
    harness.mockListResult.error = null;

    const result = await getCachedProductRatingStats('product-1');

    expect(result.totalReviews).toBe(5);
    expect(result.averageRating).toBe(3.6); // (5+5+4+3+1)/5 = 3.6
    expect(result.distribution).toEqual({ 1: 1, 2: 0, 3: 1, 4: 1, 5: 2 });
  });

  it('returns zeros when there are no reviews', async () => {
    harness.mockListResult.data = [];
    harness.mockListResult.error = null;

    const result = await getCachedProductRatingStats('product-1');

    expect(result.averageRating).toBe(0);
    expect(result.totalReviews).toBe(0);
    expect(result.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it('keeps a rating failure request-local and retries the cached read later', async () => {
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    harness.mockListResult.data = null;
    const error = { message: 'Connection error' };
    harness.mockListResult.error = error;

    await expect(getCachedProductRatingStats('product-1')).resolves.toEqual({
      averageRating: 0,
      totalReviews: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      'Optional PDP rating stats unavailable',
      { productId: 'product-1', error }
    );

    harness.mockListResult.data = [{ rating: 5 }];
    harness.mockListResult.error = null;
    await expect(getCachedProductRatingStats('product-1')).resolves.toEqual({
      averageRating: 5,
      totalReviews: 1,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
    });
    expect(cacheLife).toHaveBeenCalledWith('products');
  });

  it('returns zeros when data is null', async () => {
    harness.mockListResult.data = null;
    harness.mockListResult.error = null;

    const result = await getCachedProductRatingStats('product-1');

    expect(result.averageRating).toBe(0);
    expect(result.totalReviews).toBe(0);
  });

  it('rounds averageRating to one decimal place', async () => {
    // 3 reviews: 5, 4, 4 => avg 4.333... => rounded to 4.3
    const reviews = [{ rating: 5 }, { rating: 4 }, { rating: 4 }];
    harness.mockListResult.data = reviews;
    harness.mockListResult.error = null;

    const result = await getCachedProductRatingStats('product-1');

    expect(result.averageRating).toBe(4.3);
  });
});

describe('getCachedProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness = buildCachedDataTestHarness();
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
      auth: { getUser: vi.fn() },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws on error so a transient product failure cannot be cached as empty', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    harness.mockListResult.data = null;
    harness.mockListResult.error = { message: 'Connection error' };
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });

    await expect(getCachedProducts('merchant-1')).rejects.toEqual({
      message: 'Connection error',
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      'Error fetching products:',
      expect.objectContaining({ message: 'Connection error' })
    );
  });

  it('returns products with merged variants on success', async () => {
    const products = [
      { id: 'p1', name: 'Phone', status: 'active' },
      { id: 'p2', name: 'Tablet', status: 'active' },
    ];

    harness.mockListResult.data = products;
    harness.mockListResult.error = null;
    harness.mockRpc.mockResolvedValueOnce({
      data: [{ product_id: 'p1', id: 'v1', attributes: { color: 'red' } }],
      error: null,
    });

    const result = await getCachedProducts('merchant-1');

    expect(result).toHaveLength(2);
    // Product with variant
    expect(result[0].product_variants).toHaveLength(1);
    // Product without variant
    expect(result[1].product_variants).toEqual([]);
  });

  it('throws instead of caching products with empty variants when the variant RPC fails', async () => {
    harness.mockListResult.data = [
      { id: 'p1', name: 'Phone', status: 'active' },
    ];
    harness.mockListResult.error = null;
    harness.mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    });

    await expect(getCachedProducts('merchant-1')).rejects.toMatchObject({
      code: '57014',
      message: 'statement timeout',
    });
  });

  it('hard-caps the payload when no limit/offset is provided (PR4b)', async () => {
    harness.mockListResult.data = [];
    harness.mockListResult.error = null;
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });

    await getCachedProducts('merchant-1');

    // A full-catalog read (ogabassey ~1,333 active) must not write an unbounded
    // hydrated array into the (now local) cache item.
    expect(harness.mockLimit).toHaveBeenCalledWith(100);
  });

  it('clamps an oversized explicit limit to the row cap (PR4b)', async () => {
    harness.mockListResult.data = [];
    harness.mockListResult.error = null;
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });

    await getCachedProducts('merchant-1', { limit: 5000 });

    expect(harness.mockLimit).toHaveBeenCalledWith(100);
    expect(harness.mockLimit).not.toHaveBeenCalledWith(5000);
  });

  it('passes a small explicit limit through unchanged (PR4b)', async () => {
    harness.mockListResult.data = [];
    harness.mockListResult.error = null;
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });

    await getCachedProducts('merchant-1', { limit: 10 });

    expect(harness.mockLimit).toHaveBeenCalledWith(10);
  });
});

describe('getCachedStorefrontLaunchProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness = buildCachedDataTestHarness();
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
      auth: { getUser: vi.fn() },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('orders launch candidates by product creation time before applying the cap', async () => {
    harness.mockListResult.data = [];
    harness.mockListResult.error = null;

    await getCachedStorefrontLaunchProducts('merchant-1');

    const selectedColumns = String(harness.mockSelect.mock.calls[0]?.[0] ?? '');
    expect(selectedColumns).toContain('created_at');
    expect(selectedColumns).toContain('updated_at');
    expect(selectedColumns).toContain('has_condition_offers');
    expect(harness.mockEq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(harness.mockEq).toHaveBeenCalledWith('status', 'active');
    expect(harness.mockOrder).toHaveBeenCalledTimes(2);
    expect(harness.mockOrder).toHaveBeenNthCalledWith(1, 'created_at', {
      ascending: false,
      nullsFirst: false,
    });
    expect(harness.mockOrder).toHaveBeenNthCalledWith(2, 'price', {
      ascending: false,
    });
    expect(harness.mockLimit).toHaveBeenCalledWith(50);
    expect(cacheTag).toHaveBeenCalledWith(
      'products',
      'products-merchant-1',
      'products-launch-merchant-1-created'
    );
  });
});

describe('getCachedStorefrontHomeProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness = buildCachedDataTestHarness();
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
      auth: { getUser: vi.fn() },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('orders by price descending by default', async () => {
    harness.mockListResult.data = [];
    harness.mockListResult.error = null;

    await getCachedStorefrontHomeProducts('merchant-1');

    const selectedColumns = String(harness.mockSelect.mock.calls[0]?.[0] ?? '');
    expect(selectedColumns).toContain('created_at');
    expect(selectedColumns).toContain('has_condition_offers');
    expect(harness.mockEq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(harness.mockEq).toHaveBeenCalledWith('status', 'active');
    expect(harness.mockOrder).toHaveBeenCalledTimes(1);
    expect(harness.mockOrder).toHaveBeenCalledWith('price', {
      ascending: false,
    });
    expect(cacheTag).toHaveBeenCalledWith(
      'products',
      'products-merchant-1',
      'products-home-merchant-1-price'
    );
  });

  it('orders by most recently updated first when sort is "recent"', async () => {
    harness.mockListResult.data = [];
    harness.mockListResult.error = null;

    await getCachedStorefrontHomeProducts('merchant-1', 'recent');

    for (const [selectedColumns] of harness.mockSelect.mock.calls) {
      expect(String(selectedColumns)).toContain('has_condition_offers');
    }

    expect(harness.mockOr).toHaveBeenNthCalledWith(
      1,
      'category.ilike.%smartphone%,category.ilike.%mobile%,category.ilike.%phone%'
    );
    expect(harness.mockOr).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('name.ilike.%smartphone%'),
      { referencedTable: 'categories' }
    );
    expect(harness.mockOr).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('name.ilike.%smartphone%'),
      { referencedTable: 'product_categories.categories' }
    );
    expect(harness.mockNot).toHaveBeenCalledWith(
      'category',
      'ilike',
      '%headphone%'
    );
    expect(harness.mockNot).toHaveBeenCalledWith(
      'category',
      'ilike',
      '%earphone%'
    );
    expect(harness.mockNot).toHaveBeenCalledWith(
      'category',
      'ilike',
      '%microphone%'
    );
    expect(harness.mockNot).toHaveBeenCalledWith(
      'category',
      'ilike',
      '%charger%'
    );
    expect(harness.mockOrder).toHaveBeenCalledTimes(8);
    expect(harness.mockOrder).toHaveBeenNthCalledWith(1, 'updated_at', {
      ascending: false,
      nullsFirst: false,
    });
    // Price stays as a stable tiebreaker for products updated in the same tick.
    expect(harness.mockOrder).toHaveBeenNthCalledWith(2, 'price', {
      ascending: false,
    });
    expect(harness.mockOrder).toHaveBeenNthCalledWith(3, 'updated_at', {
      ascending: false,
      nullsFirst: false,
    });
    expect(harness.mockOrder).toHaveBeenNthCalledWith(4, 'price', {
      ascending: false,
    });
    expect(harness.mockOrder).toHaveBeenNthCalledWith(5, 'updated_at', {
      ascending: false,
      nullsFirst: false,
    });
    expect(harness.mockOrder).toHaveBeenNthCalledWith(6, 'price', {
      ascending: false,
    });
    expect(harness.mockOrder).toHaveBeenNthCalledWith(7, 'updated_at', {
      ascending: false,
      nullsFirst: false,
    });
    expect(harness.mockOrder).toHaveBeenNthCalledWith(8, 'price', {
      ascending: false,
    });
    expect(harness.mockLimit).toHaveBeenNthCalledWith(1, 24);
    expect(harness.mockLimit).toHaveBeenNthCalledWith(2, 24);
    expect(harness.mockLimit).toHaveBeenNthCalledWith(3, 24);
    expect(harness.mockLimit).toHaveBeenNthCalledWith(4, 50);
    expect(cacheTag).toHaveBeenCalledWith(
      'products',
      'products-merchant-1',
      'products-home-merchant-1-recent'
    );
  });

  it('keeps phone candidates ahead of the general recent window before hydration', async () => {
    harness.mockListResults.push(
      {
        data: [
          {
            id: 'phone-1',
            name: 'Older iPhone',
            category: 'Smartphones',
            price: 800000,
          },
        ],
        error: null,
      },
      {
        data: [],
        error: null,
      },
      {
        data: [],
        error: null,
      },
      {
        data: [
          {
            id: 'case-1',
            name: 'Fresh Case',
            category: 'Accessories',
            price: 15000,
          },
          {
            id: 'phone-1',
            name: 'Older iPhone',
            category: 'Smartphones',
            price: 800000,
          },
        ],
        error: null,
      }
    );
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const products = await getCachedStorefrontHomeProducts(
      'merchant-1',
      'recent'
    );

    expect(products.map((product) => product.id)).toEqual([
      'phone-1',
      'case-1',
    ]);
  });

  it('keeps relation-backed phone candidates ahead of the general recent window', async () => {
    harness.mockListResults.push(
      {
        data: [],
        error: null,
      },
      {
        data: [],
        error: null,
      },
      {
        data: [
          {
            id: 'relation-phone-1',
            name: 'Older Relation iPhone',
            category: null,
            updated_at: '2026-01-01T00:00:00.000Z',
            product_categories: [
              { categories: { name: 'Smartphones', slug: 'smartphones' } },
            ],
            price: 800000,
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: 'case-1',
            name: 'Fresh Case',
            category: 'Accessories',
            price: 15000,
          },
        ],
        error: null,
      }
    );
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const products = await getCachedStorefrontHomeProducts(
      'merchant-1',
      'recent'
    );

    expect(products.map((product) => product.id)).toEqual([
      'relation-phone-1',
      'case-1',
    ]);
  });

  it('does not promote stale relation categories when direct category_id is non-phone', async () => {
    harness.mockListResults.push(
      {
        data: [],
        error: null,
      },
      {
        data: [],
        error: null,
      },
      {
        data: [
          {
            id: 'stale-accessory-1',
            name: 'Phone Case With Old Relation',
            category: null,
            categories: {
              id: 'cat-accessories',
              name: 'Accessories',
              slug: 'accessories',
            },
            product_categories: [
              { categories: { name: 'Smartphones', slug: 'smartphones' } },
            ],
            price: 25000,
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: 'fresh-case-1',
            name: 'Fresh Case',
            category: 'Accessories',
            price: 15000,
            updated_at: '2026-01-03T00:00:00.000Z',
          },
          {
            id: 'stale-accessory-1',
            name: 'Phone Case With Old Relation',
            category: null,
            categories: {
              id: 'cat-accessories',
              name: 'Accessories',
              slug: 'accessories',
            },
            product_categories: [
              { categories: { name: 'Smartphones', slug: 'smartphones' } },
            ],
            price: 25000,
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
        error: null,
      }
    );
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const products = await getCachedStorefrontHomeProducts(
      'merchant-1',
      'recent'
    );

    expect(products.map((product) => product.id)).toEqual([
      'fresh-case-1',
      'stale-accessory-1',
    ]);
  });

  it('keeps direct category_id phone candidates ahead of the general recent window', async () => {
    harness.mockListResults.push(
      {
        data: [],
        error: null,
      },
      {
        data: [
          {
            id: 'direct-phone-1',
            name: 'Direct Category iPhone',
            category: null,
            categories: {
              id: 'cat-phone',
              name: 'Smartphones',
              slug: 'smartphones',
            },
            price: 900000,
            updated_at: '2026-01-02T00:00:00.000Z',
          },
        ],
        error: null,
      },
      {
        data: [],
        error: null,
      },
      {
        data: [
          {
            id: 'case-1',
            name: 'Fresh Case',
            category: 'Accessories',
            price: 15000,
            updated_at: '2026-01-03T00:00:00.000Z',
          },
        ],
        error: null,
      }
    );
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const products = await getCachedStorefrontHomeProducts(
      'merchant-1',
      'recent'
    );

    expect(products.map((product) => product.id)).toEqual([
      'direct-phone-1',
      'case-1',
    ]);
  });

  it('merge-sorts phone candidates by recency before the homepage slice', async () => {
    harness.mockListResults.push(
      {
        data: [
          {
            id: 'legacy-phone',
            name: 'Legacy Phone',
            category: 'Phones',
            price: 600000,
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: 'direct-phone',
            name: 'Direct Phone',
            category: null,
            categories: {
              id: 'cat-phone',
              name: 'Mobile Phones',
              slug: 'mobile-phones',
            },
            price: 700000,
            updated_at: '2026-01-03T00:00:00.000Z',
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: 'relation-phone',
            name: 'Relation Phone',
            category: null,
            product_categories: [
              { categories: { name: 'Smartphones', slug: 'smartphones' } },
            ],
            price: 800000,
            updated_at: '2026-01-02T00:00:00.000Z',
          },
        ],
        error: null,
      },
      {
        data: [],
        error: null,
      }
    );
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const products = await getCachedStorefrontHomeProducts(
      'merchant-1',
      'recent'
    );

    expect(products.map((product) => product.id)).toEqual([
      'direct-phone',
      'relation-phone',
      'legacy-phone',
    ]);
  });

  it('fails fast when the first recent products query errors', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    harness.mockListResults.push(
      { data: null, error: { message: 'Connection error' } },
      { data: [{ id: 'should-not-run' }], error: null }
    );

    await expect(
      getCachedStorefrontHomeProducts('merchant-1', 'recent')
    ).rejects.toMatchObject({ message: 'Connection error' });

    expect(harness.mockQueryExecution).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to load storefront home products',
      expect.objectContaining({
        merchantId: 'merchant-1',
        error: { message: 'Connection error' },
      })
    );
  });
});
