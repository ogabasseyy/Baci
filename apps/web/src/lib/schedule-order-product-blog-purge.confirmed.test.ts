import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnrichProductPurgeEntries = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockPurgeStorefrontProductConfirmed = vi.fn().mockResolvedValue(true);
const mockScheduleStorefrontHostnamePurge = vi.fn();
const mockPurgeStorefrontHostnameConfirmed = vi.fn().mockResolvedValue(true);
const mockExpireProductBlogCacheReliable = vi.fn().mockResolvedValue(true);
const mockGetCloudflarePurgeCredentials = vi.fn();
const mockDelegateStorefrontEdgePurge = vi.fn().mockResolvedValue(false);
const mockRevalidateSlugs = vi.fn();
const mockRevalidateProducts = vi.fn();
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProductSlugs: (...args: unknown[]) => mockRevalidateSlugs(...args),
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
}));
vi.mock('@/lib/cloudflare-purge-credentials', () => ({
  getCloudflarePurgeCredentials: () => mockGetCloudflarePurgeCredentials(),
}));
vi.mock('@/lib/delegate-storefront-edge-purge', () => ({
  delegateStorefrontEdgePurge: (...args: unknown[]) =>
    mockDelegateStorefrontEdgePurge(...args),
}));
vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: (...args: unknown[]) =>
    mockEnrichProductPurgeEntries(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
  purgeStorefrontProductConfirmed: (...args: unknown[]) =>
    mockPurgeStorefrontProductConfirmed(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
  purgeStorefrontHostnameConfirmed: (...args: unknown[]) =>
    mockPurgeStorefrontHostnameConfirmed(...args),
}));
vi.mock('@/lib/expire-product-blog-cache-reliable', () => ({
  expireProductBlogCacheReliable: (...args: unknown[]) =>
    mockExpireProductBlogCacheReliable(...args),
}));

import { scheduleOrderProductBlogPurge } from './schedule-order-product-blog-purge';

function makeSupabase() {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  };
}

describe('scheduleOrderProductBlogPurge confirmed edge eviction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevalidateProducts.mockReturnValue(true);
    mockRevalidateSlugs.mockReturnValue(true);
    mockGetCloudflarePurgeCredentials.mockReturnValue(undefined);
    mockDelegateStorefrontEdgePurge.mockResolvedValue(false);
    mockEnrichProductPurgeEntries.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      authoritativeSlugsById: new Map([['product-1', 'iphone-15']]),
      blogPostSlugs: ['iphone-guide'],
    });
  });

  it('awaits confirmed edge eviction and returns false when Cloudflare confirmation fails', async () => {
    const supabase = makeSupabase();
    mockPurgeStorefrontProductConfirmed.mockResolvedValueOnce(false);

    const failed = await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['product-1'],
      supabase: supabase as never,
      confirmEdgeEviction: true,
    });
    expect(failed).toBe(false);
    expect(mockPurgeStorefrontProductConfirmed).toHaveBeenCalledTimes(1);
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();

    mockPurgeStorefrontHostnameConfirmed.mockResolvedValueOnce(false);
    const failedHostname = await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['product-1'],
      supabase: supabase as never,
      targetSweepIncomplete: true,
      confirmEdgeEviction: true,
    });
    expect(failedHostname).toBe(false);
    expect(mockPurgeStorefrontHostnameConfirmed).toHaveBeenCalledWith(
      'ogabassey'
    );
  });

  it('delegates confirmed edge eviction when local Cloudflare credentials are missing', async () => {
    const supabase = makeSupabase();
    mockPurgeStorefrontProductConfirmed.mockResolvedValueOnce(false);
    mockGetCloudflarePurgeCredentials.mockReturnValue(undefined);
    mockDelegateStorefrontEdgePurge.mockResolvedValueOnce(true);

    const ok = await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['product-1'],
      supabase: supabase as never,
      confirmEdgeEviction: true,
    });

    expect(ok).toBe(true);
    expect(mockDelegateStorefrontEdgePurge).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      productIds: ['product-1'],
      productSlugs: ['iphone-15'],
      blogPostSlugs: ['iphone-guide'],
      purgeWholeStorefront: false,
    });
  });

  it('does not delegate when local Cloudflare credentials are configured and confirmation fails', async () => {
    const supabase = makeSupabase();
    mockPurgeStorefrontProductConfirmed.mockResolvedValueOnce(false);
    mockGetCloudflarePurgeCredentials.mockReturnValue({
      token: 'cf-token',
      zoneId: 'cf-zone',
    });

    const ok = await scheduleOrderProductBlogPurge({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      productIds: ['product-1'],
      supabase: supabase as never,
      confirmEdgeEviction: true,
    });

    expect(ok).toBe(false);
    expect(mockDelegateStorefrontEdgePurge).not.toHaveBeenCalled();
  });
});
