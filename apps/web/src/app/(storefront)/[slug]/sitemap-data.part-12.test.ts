import { describe, expect, it, vi } from 'vitest';
import {
  mockBuildCommercialSupportDiscoveryLinks,
  mockCategoriesQuery,
  mockGetCachedCategoryPageData,
  mockGetMerchantByIdentifier,
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

  it('loads commercial-support sitemap categories in bounded concurrent batches', async () => {
    const { SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY } = sitemapData;
    mockCategoriesQuery(
      Array.from(
        { length: SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY + 1 },
        (_, index) => ({
          slug: `category-${index}`,
          updated_at: '2026-01-01T00:00:00Z',
        })
      )
    );
    let activeLoads = 0;
    let maxActiveLoads = 0;
    mockGetCachedCategoryPageData.mockImplementation(async () => {
      activeLoads += 1;
      maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
      await Promise.resolve();
      activeLoads -= 1;

      return {
        isCollection: false,
        fallbackName: 'Category',
        products: [
          {
            id: 'iphone-17-pro-max',
            slug: 'iphone-17-pro-max',
            name: 'iPhone 17 Pro Max',
            brand: 'Apple',
            price: 495000,
            category_slug: 'smartphones',
            product_key_specs: {
              chipset: 'A19 Pro',
              ram_gb: 8,
              storage_gb: 256,
            },
          },
        ],
      };
    });
    mockBuildCommercialSupportDiscoveryLinks.mockImplementation(
      ({ categorySlug }: { categorySlug: string }) => [
        {
          href: `https://ogabassey.com/${categorySlug}/compare/a-vs-b`,
          label: 'A vs B',
        },
      ]
    );
    const {
      getCommercialSupportSitemapEntries,
      resolveStorefrontSitemapContext,
    } = sitemapData;
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    const context = await resolveStorefrontSitemapContext(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getCommercialSupportSitemapEntries(context);

    expect(entries).toHaveLength(
      SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY + 1
    );
    expect(maxActiveLoads).toBe(
      SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY
    );
  });
});
