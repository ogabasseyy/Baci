import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockCookies = vi.fn();
const mockFrom = vi.fn();
const mockFetchAnalyticsPlatformConfig = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockGetAdsAnalyticsCacheVersion = vi.fn();
const mockBuildAdsAnalyticsCacheKey = vi.fn();
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: (...args: unknown[]) => mockCookies(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));
vi.mock('@/lib/analytics/analytics-platform-config', () => ({
  fetchAnalyticsPlatformConfig: (...args: unknown[]) =>
    mockFetchAnalyticsPlatformConfig(...args),
}));
vi.mock('@/lib/ads/analytics-cache', () => ({
  buildAdsAnalyticsCacheKey: (...args: unknown[]) =>
    mockBuildAdsAnalyticsCacheKey(...args),
  getAdsAnalyticsCacheVersion: (...args: unknown[]) =>
    mockGetAdsAnalyticsCacheVersion(...args),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
  toUserAccess: () => ({ role: 'owner' }),
}));
vi.mock('@/lib/api-auth', () => ({ hasPermission: () => true }));
vi.mock('@/lib/cache', () => ({
  cache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
  },
  generateCacheKey: () => 'ads-cache-key',
}));

import { GET } from './route';

describe('GET /api/analytics/ads', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T10:00:00.000Z'));
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({});
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetAdsAnalyticsCacheVersion.mockResolvedValue('ads-revision-1');
    mockBuildAdsAnalyticsCacheKey.mockReturnValue('ads-cache-key');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('authenticates before parsing an invalid analytics date query', async () => {
    const response = await GET(
      new Request(
        'https://usebaci.com/api/analytics/ads?startDate=not-a-date'
      ) as unknown as NextRequest
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('rejects a multi-year reporting range before tenant database work', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    const response = await GET(
      new Request(
        'https://usebaci.com/api/analytics/ads?startDate=2024-01-01&endDate=2025-01-01'
      ) as unknown as NextRequest
    );

    expect(response.status).toBe(400);
    expect(mockGetMerchantForApiRequest).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns social reporting separately from legacy click attribution without secrets', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
    });
    mockFetchAnalyticsPlatformConfig.mockResolvedValue({
      facebook_capi_token: 'must-not-leak',
      facebook_pixel_id: 'pixel-1',
      ga4_api_secret: null,
      google_analytics_id: null,
      offline_conversions_enabled: true,
      snapchat_capi_token: null,
      snapchat_pixel_id: null,
      tiktok_access_token: null,
      tiktok_pixel_id: null,
    });

    const results = [
      {
        data: [
          {
            ad_tracking: { fbclid: 'click-1' },
            created_at: '2026-08-20T10:00:00.000Z',
            id: 'order-1',
            payment_status: 'paid',
            total: '5000',
          },
        ],
        error: null,
      },
      {
        data: {
          last_synced_at: '2026-08-22T09:00:00.000Z',
          provider_customer_id: 'google-1',
          status: 'active',
        },
        error: null,
      },
      {
        data: [
          {
            account_timezone: 'Africa/Lagos',
            last_synced_at: '2026-08-22T09:00:00.000Z',
            provider: 'meta_ads',
            provider_account_label: 'Baci Meta',
            provider_customer_id: 'act_1',
            status: 'active',
            token_expires_at: '2099-01-01T00:00:00.000Z',
          },
        ],
        error: null,
      },
      {
        data: [
          {
            account_timezone: 'Africa/Lagos',
            clicks: '4',
            conversions: '1',
            currency_code: 'NGN',
            fetched_at: '2026-08-22T09:00:00.000Z',
            impressions: '100',
            provider: 'meta_ads',
            provider_customer_id: 'act_1',
            reach: '80',
            spend_amount_decimal: '1250.50',
            spend_date: '2026-08-20',
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    const terminals = ['limit', 'maybeSingle', 'in', 'range', 'range'] as const;
    let queryIndex = 0;
    mockFrom.mockImplementation(() =>
      chainResult(results.shift(), terminals[queryIndex++])
    );

    const response = await GET(
      new Request(
        'https://usebaci.com/api/analytics/ads?startDate=2026-08-01&endDate=2026-08-22&orderStart=2026-08-01T12:34:56.000Z&orderEnd=2026-08-22T18:45:00.000Z'
      ) as unknown as NextRequest
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.platforms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clickAttributed: 1,
          name: 'Facebook',
          revenue: 5000,
        }),
      ])
    );
    expect(body.socialAds.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metrics: expect.objectContaining({
            conversions: '1',
            spendByCurrency: [
              { currencyCode: 'NGN', spendAmountDecimal: '1250.5' },
            ],
          }),
          provider: 'meta_ads',
        }),
      ])
    );
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
  });

  it('uses inclusive UTC instants for legacy orders while preserving date-only provider windows', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
    });
    mockFetchAnalyticsPlatformConfig.mockResolvedValue({
      facebook_capi_token: null,
      facebook_pixel_id: null,
      ga4_api_secret: null,
      google_analytics_id: null,
      offline_conversions_enabled: true,
      snapchat_capi_token: null,
      snapchat_pixel_id: null,
      tiktok_access_token: null,
      tiktok_pixel_id: null,
    });

    const ordersQuery = chainResult({ data: [], error: null }, 'limit');
    const results = [
      ordersQuery,
      chainResult({ data: null, error: null }, 'maybeSingle'),
      chainResult({ data: [], error: null }, 'in'),
      chainResult({ data: [], error: null }, 'range'),
    ];
    mockFrom.mockImplementation(() => results.shift());

    const response = await GET(
      new Request(
        'https://usebaci.com/api/analytics/ads?startDate=2026-08-01&endDate=2026-08-22&orderStart=2026-08-01T12:34:56.000Z&orderEnd=2026-08-22T18:45:00.000Z'
      ) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(ordersQuery.gte).toHaveBeenCalledWith(
      'created_at',
      '2026-08-01T12:34:56.000Z'
    );
    expect(ordersQuery.lte).toHaveBeenCalledWith(
      'created_at',
      '2026-08-22T18:45:00.000Z'
    );
  });
});

function chainResult(
  result: { data: unknown; error: unknown } | undefined,
  terminal: 'in' | 'limit' | 'maybeSingle' | 'order' | 'range' | undefined
): Record<string, ReturnType<typeof vi.fn>> {
  const resolved = result ?? { data: null, error: null };
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'eq',
    'gte',
    'in',
    'limit',
    'lte',
    'or',
    'order',
    'range',
    'select',
  ]) {
    chain[method] = vi.fn(() =>
      method === terminal ? Promise.resolve(resolved) : chain
    );
  }
  chain.maybeSingle = vi.fn(() =>
    terminal === 'maybeSingle' ? Promise.resolve(resolved) : chain
  );
  return chain;
}
