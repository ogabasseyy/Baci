import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSingle,
  mockEq,
  mockSelect,
  mockGetCachedFeatureSettings,
  mockGetCachedMerchantPaystackSubaccountConfigured,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockSingle: vi.fn(),
  mockEq: vi.fn(),
  mockSelect: vi.fn(),
  mockGetCachedFeatureSettings: vi.fn(),
  mockGetCachedMerchantPaystackSubaccountConfigured: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({
    from: () => ({
      select: mockSelect,
    }),
  }),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedFeatureSettings: (...args: unknown[]) =>
    mockGetCachedFeatureSettings(...args),
  getCachedMerchantPaystackSubaccountConfigured: (...args: unknown[]) =>
    mockGetCachedMerchantPaystackSubaccountConfigured(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

import { getStorefrontFeatures } from './get-storefront-features';

describe('getStorefrontFeatures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });
    mockGetCachedFeatureSettings.mockResolvedValue({
      paystack_enabled: true,
      korapay_enabled: true,
      blog_enabled: true,
    });
    mockGetCachedMerchantPaystackSubaccountConfigured.mockResolvedValue(true);
  });

  it('returns 404 when the merchant is not found (PGRST116)', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    await expect(getStorefrontFeatures({ slug: 'missing' })).resolves.toEqual({
      status: 404,
    });
  });

  it('throws on unexpected merchant lookup errors', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: '500', message: 'connection reset' },
    });

    await expect(
      getStorefrontFeatures({ merchantId: 'merchant-1' })
    ).rejects.toThrow(
      'Storefront features merchant lookup failed: connection reset'
    );
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });

  it('returns normalized features with degraded=false when subaccount lookup succeeds', async () => {
    mockSingle.mockResolvedValue({
      data: { id: 'merchant-1', country: 'NG', business_type: 'electronics' },
      error: null,
    });

    const result = await getStorefrontFeatures({ slug: 'ogabassey' });

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.degraded).toBe(false);
    expect(result.merchantId).toBe('merchant-1');
    expect(result.features.paystackEnabled).toBe(true);
    expect(result.features.blogEnabled).toBe(true);
  });

  it('marks result degraded=true and fails closed on paystack when subaccount RPC throws', async () => {
    mockSingle.mockResolvedValue({
      data: { id: 'merchant-1', country: 'NG', business_type: 'electronics' },
      error: null,
    });
    mockGetCachedMerchantPaystackSubaccountConfigured.mockRejectedValue(
      new Error('rpc timeout')
    );

    const result = await getStorefrontFeatures({ merchantId: 'merchant-1' });

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.degraded).toBe(true);
    expect(result.features.paystackEnabled).toBe(false);
    expect(result.features.preferredLocalGateway).toBe('korapay');
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });
});
