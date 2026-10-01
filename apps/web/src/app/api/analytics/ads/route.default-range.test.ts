import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));
vi.mock('@/lib/analytics/analytics-platform-config', () => ({
  fetchAnalyticsPlatformConfig: vi.fn().mockResolvedValue({
    offline_conversions_enabled: true,
  }),
}));
vi.mock('@/lib/ads/analytics-cache', () => ({
  buildAdsAnalyticsCacheKey: vi.fn().mockReturnValue('ads-cache-key'),
  getAdsAnalyticsCacheVersion: vi.fn().mockResolvedValue('ads-revision-1'),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn().mockResolvedValue({
    merchantId: 'merchant-1',
  }),
  toUserAccess: () => ({ role: 'owner' }),
}));
vi.mock('@/lib/api-auth', () => ({ hasPermission: () => true }));
vi.mock('@/lib/cache', () => ({
  cache: { get: vi.fn(), set: vi.fn() },
  generateCacheKey: () => 'ads-cache-key',
}));

import { GET } from './route';

describe('GET /api/analytics/ads default range', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('uses exactly 30 inclusive calendar days when dates are omitted', async () => {
    const ordersQuery = createQuery({ data: [], error: null }, 'limit');
    const results = [
      ordersQuery,
      createQuery({ data: null, error: null }, 'maybeSingle'),
      createQuery({ data: [], error: null }, 'in'),
      createQuery({ data: [], error: null }, 'range'),
    ];
    mockFrom.mockImplementation(() => results.shift());

    const response = await GET(
      new Request(
        'https://usebaci.com/api/analytics/ads'
      ) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(ordersQuery.gte).toHaveBeenCalledWith(
      'created_at',
      '2026-07-27T00:00:00.000Z'
    );
    expect(ordersQuery.lte).toHaveBeenCalledWith(
      'created_at',
      '2026-08-25T23:59:59.999Z'
    );
  });
});

function createQuery(
  result: { data: unknown; error: unknown },
  terminal: 'in' | 'limit' | 'maybeSingle' | 'range'
): Record<string, ReturnType<typeof vi.fn>> {
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
      method === terminal ? Promise.resolve(result) : chain
    );
  }
  chain.maybeSingle = vi.fn(() =>
    terminal === 'maybeSingle' ? Promise.resolve(result) : chain
  );
  return chain;
}
