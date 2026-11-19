import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockEnrich = vi.fn();
const mockExpireBlog = vi.fn();
const mockPurgeProduct = vi.fn();
const mockPurgeHostname = vi.fn();

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));
vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: (...args: unknown[]) => mockEnrich(...args),
}));
vi.mock('@/lib/resolve-dependent-legacy-product-identifiers', () => ({
  resolveDependentLegacyProductIdentifiers: () =>
    Promise.resolve({ identifiers: [], incomplete: false }),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) => mockExpireBlog(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockPurgeProduct(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockPurgeHostname(...args),
}));

import { revalidateProductsInProcess } from './revalidate-products-in-process';

describe('revalidateProductsInProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevalidateProducts.mockReturnValue(true);
    mockRevalidateProductSlugs.mockReturnValue(true);
  });

  it('throws when revalidateProducts signals no request context', async () => {
    mockRevalidateProducts.mockReturnValue(false);

    await expect(
      revalidateProductsInProcess({
        merchantId: 'merchant-1',
        nextProductSlugs: [],
      })
    ).rejects.toThrow('Product cache revalidation requires a request context');
  });

  it('hard-expires merchant-wide PDP details when an ID-only product lacks an authoritative slug', async () => {
    mockEnrich.mockResolvedValue({
      entries: [{ slug: 'prod-1', categorySegment: null }],
      resolvedSlugs: ['prod-1'],
      authoritativeSlugsById: new Map<string, string>(),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    await revalidateProductsInProcess({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      products: [{ id: 'prod-1' }],
      nextProductSlugs: [],
      supabase: {} as never,
    });

    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });

  it('keeps merchant-wide PDP details out of immediate expiry when scoped slugs are complete', async () => {
    mockEnrich.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    await revalidateProductsInProcess({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      products: [
        { id: 'prod-1', slug: 'iphone-15', previousSlug: 'iphone-15' },
      ],
      nextProductSlugs: [],
      supabase: {} as never,
    });

    expect(mockRevalidateProducts).toHaveBeenCalledTimes(1);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      'merchant-1',
      ['iphone-15', 'prod-1'],
      { expireImmediately: true }
    );
  });

  it('hard-expires merchant-wide PDP details when an ID-only product lacks previousSlug evidence', async () => {
    mockEnrich.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    await revalidateProductsInProcess({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      products: [{ id: 'prod-1' }],
      nextProductSlugs: [],
      supabase: {} as never,
    });

    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });

  it('throws before edge purging when merchant-wide hard expiry returns false', async () => {
    mockRevalidateProductSlugs.mockReturnValueOnce(false);
    mockRevalidateProducts.mockReturnValueOnce(false);
    mockEnrich.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    await expect(
      revalidateProductsInProcess({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        products: [{ id: 'prod-1' }],
        nextProductSlugs: [],
        supabase: {} as never,
      })
    ).rejects.toThrow('Merchant-wide product hard expiry failed');
    expect(mockPurgeProduct).not.toHaveBeenCalled();

    mockRevalidateProducts.mockReturnValueOnce(false);
    await expect(
      revalidateProductsInProcess({
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        nextProductSlugs: [],
        purgeWholeStorefront: true,
      })
    ).rejects.toThrow('Merchant-wide product hard expiry failed');
    expect(mockPurgeHostname).not.toHaveBeenCalled();
  });

  it('hard-expires merchant-wide PDP details when scoped slug revalidation returns false', async () => {
    mockRevalidateProductSlugs.mockReturnValueOnce(false);
    mockEnrich.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    await revalidateProductsInProcess({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      products: [{ id: 'prod-1' }],
      nextProductSlugs: [],
      supabase: {} as never,
    });

    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });
});
