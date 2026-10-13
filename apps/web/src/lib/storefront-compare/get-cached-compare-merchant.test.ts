import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedCompareMerchantByIdentifier } from './get-cached-compare-merchant';

const mockReadStorefrontMerchantSnapshot = vi.fn();
const mockGetPublicSupabaseClient = vi.fn();
const mockCacheLife = vi.fn();
const mockCacheTag = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: (...args: string[]) => mockCacheLife(...args),
  cacheTag: (...args: string[]) => mockCacheTag(...args),
}));

vi.mock('@/lib/public-supabase-client', () => ({
  getPublicSupabaseClient: () => mockGetPublicSupabaseClient(),
}));

vi.mock('@/lib/storefront-merchant-snapshot', () => ({
  readStorefrontMerchantSnapshot: (...args: unknown[]) =>
    mockReadStorefrontMerchantSnapshot(...args),
}));

describe('getCachedCompareMerchantByIdentifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicSupabaseClient.mockReturnValue({});
  });

  it('returns the narrow public merchant projection for a slug', async () => {
    mockReadStorefrontMerchantSnapshot.mockResolvedValue({
      status: 'found',
      value: {
        custom_domain: null,
        feature_settings: null,
        merchant_data: {
          id: 'merchant-1',
          is_published: true,
          slug: 'ogabassey',
        },
        resolution_status: 'found',
      },
    });

    await expect(
      getCachedCompareMerchantByIdentifier('OGABASSEY')
    ).resolves.toEqual({
      custom_domain: null,
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
    });
    expect(mockReadStorefrontMerchantSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      'ogabassey'
    );
  });

  it('returns null for invalid identifiers without querying Supabase', async () => {
    await expect(
      getCachedCompareMerchantByIdentifier('not a valid identifier')
    ).resolves.toBeNull();
    expect(mockReadStorefrontMerchantSnapshot).not.toHaveBeenCalled();
  });

  it('preserves unavailable snapshot failures for the caller to fail open', async () => {
    mockReadStorefrontMerchantSnapshot.mockResolvedValue({
      status: 'unavailable',
      error: {
        kind: 'timeout',
        operation: 'merchant_snapshot',
        retryable: true,
      },
    });

    await expect(
      getCachedCompareMerchantByIdentifier('ogabassey')
    ).rejects.toMatchObject({
      failure: {
        kind: 'timeout',
        operation: 'merchant_snapshot',
      },
    });
  });
});
