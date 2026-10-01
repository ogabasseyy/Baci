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

describe('GET /api/analytics/ads cache', () => {
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

  it('stores a cache-busted response so ordinary readers do not see stale data', async () => {
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
    mockFrom.mockImplementation(() =>
      chainResult({ data: [], error: null }, 'limit')
    );

    const response = await GET(
      new Request(
        'https://usebaci.com/api/analytics/ads?startDate=2026-08-01&endDate=2026-08-22&cacheBust=2'
      ) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(mockCacheSet).toHaveBeenCalledWith(
      'ads-cache-key',
      expect.anything(),
      300
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
