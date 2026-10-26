import { describe, expect, it, vi } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';
import {
  mockGetBrandAuthorityCategory,
  mockGetCachedBrandAuthorityInventory,
  registerSitemapDataTests,
  sitemapData,
} from './sitemap-data.test-setup';

vi.mock('@/lib/cached-data', async () => {
  const s = await import('./sitemap-data.test-setup');
  return {
    getMerchantByIdentifier: (...args: unknown[]) =>
      s.mockGetMerchantByIdentifier(...args),
    getCachedCategoryPageData: (...args: unknown[]) =>
      s.mockGetCachedCategoryPageData(...args),
  };
});
vi.mock('@/lib/cached-category-product-counts', async () => {
  const s = await import('./sitemap-data.test-setup');
  return {
    getCachedCategoryProductCounts: (...args: unknown[]) =>
      s.mockGetCachedCategoryProductCounts(...args),
  };
});
vi.mock('@/lib/storefront-category/brand-authority-public-data', async () => {
  const s = await import('./sitemap-data.test-setup');
  return {
    brandAuthorityPublicData: {
      getCategory: (...args: unknown[]) =>
        s.mockGetBrandAuthorityCategory(...args),
    },
  };
});
vi.mock(
  '@/lib/storefront-category/get-cached-brand-authority-inventory',
  async () => {
    const s = await import('./sitemap-data.test-setup');
    return {
      getCachedBrandAuthorityInventory: (...args: unknown[]) =>
        s.mockGetCachedBrandAuthorityInventory(...args),
    };
  }
);
vi.mock('@/lib/storefront-compare/build-compare-discovery-links', async () => {
  const s = await import('./sitemap-data.test-setup');
  return {
    buildCommercialSupportDiscoveryLinks: (...args: unknown[]) =>
      s.mockBuildCommercialSupportDiscoveryLinks(...args),
  };
});
vi.mock('@/lib/seo-utils', () => ({
  generateSlug: vi.fn((str: string) => str.toLowerCase().replace(/\s+/g, '-')),
  getValidatedProductUrl: vi.fn(
    (
      product: {
        id: string;
        slug?: string | null;
        category_slug?: string | null;
        categories?: { slug?: string | null } | null;
      },
      baseUrl: string
    ) => {
      const slug = product.slug || product.id;
      const categorySlug = product.categories?.slug || product.category_slug;
      const productPath = categorySlug
        ? `/${categorySlug}/${slug}`
        : `/products/${slug}`;
      return `${new URL(baseUrl).origin}${productPath}`;
    }
  ),
}));
vi.mock('@/lib/supabase/anon', async () => {
  const s = await import('./sitemap-data.test-setup');
  return {
    createAnonClient: vi.fn(() => ({
      from: (table: string) => ({
        select: (columns?: string) => {
          if (columns) {
            s.mockSelectCalls.push(columns);
          }
          return { eq: s.createEq(table) };
        },
      }),
    })),
  };
});

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('lists only inventory-qualified curated brand authority hubs', async () => {
    mockGetBrandAuthorityCategory.mockResolvedValue({
      id: 'category-1',
      name: 'Smartphones',
    });
    mockGetCachedBrandAuthorityInventory.mockImplementation(
      async (
        _merchantId: string,
        _categorySlug: string,
        entry: { brandKey: string }
      ) => ({
        latestUpdatedAt:
          entry.brandKey === 'samsung' ? '2026-07-14T00:00:00Z' : null,
        productCount: { google: 5, samsung: 5, tecno: 4 }[entry.brandKey] ?? 0,
      })
    );
    const { getBrandAuthoritySitemapEntries } = sitemapData;

    const entries = await getBrandAuthoritySitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {},
    } as unknown as StorefrontSitemapContext);

    expect(entries.map((entry) => entry.url)).toEqual([
      'https://ogabassey.com/smartphones/brands/samsung',
      'https://ogabassey.com/smartphones/brands/google',
    ]);
    expect(entries[0]?.lastModified).toEqual(new Date('2026-07-14T00:00:00Z'));
    expect(entries[1]?.lastModified).toBeUndefined();
    // Pin the curated authority set explicitly (9 smartphone brands +
    // laptops Apple) so taxonomy edits cannot silently expand sitemap fan-out.
    expect(mockGetCachedBrandAuthorityInventory).toHaveBeenCalledTimes(10);
  });

  it('keeps successful authority hubs when a single brand query fails', async () => {
    mockGetBrandAuthorityCategory.mockResolvedValue({
      id: 'category-1',
      name: 'Smartphones',
    });
    mockGetCachedBrandAuthorityInventory.mockImplementation(
      async (
        _merchantId: string,
        _categorySlug: string,
        entry: { brandKey: string }
      ) => {
        if (entry.brandKey !== 'samsung') throw new Error('timeout');
        return { latestUpdatedAt: '2026-07-14T00:00:00Z', productCount: 5 };
      }
    );
    const { getBrandAuthoritySitemapEntries } = sitemapData;

    const entries = await getBrandAuthoritySitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {},
    } as unknown as StorefrontSitemapContext);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/brands/samsung',
      }),
    ]);
  });

  it('omits authority hubs when the category cannot render publicly', async () => {
    mockGetBrandAuthorityCategory.mockResolvedValue(null);
    const { getBrandAuthoritySitemapEntries } = sitemapData;

    await expect(
      getBrandAuthoritySitemapEntries({
        merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
        storeUrl: 'https://ogabassey.com',
        supabase: {},
      } as unknown as StorefrontSitemapContext)
    ).resolves.toEqual([]);
    expect(mockGetCachedBrandAuthorityInventory).not.toHaveBeenCalled();
  });
});
