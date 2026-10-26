import { describe, expect, it, vi } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';
import {
  mockGetMerchantByIdentifier,
  mockHeaders,
  registerSitemapDataTests,
  setCustomDomainHeader,
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

  it('throws when the repairs device query errors so the route can 503', async () => {
    const { getRepairsSitemapEntries } = sitemapData;

    await expect(
      getRepairsSitemapEntries({
        merchant: {
          id: 'merchant-1',
          is_published: true,
          slug: 'ogabassey',
          business_type: 'electronics',
          feature_settings: { repairs_catalog_enabled: true },
        },
        storeUrl: 'https://ogabassey.com',
        supabase: {
          from: () => ({
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    data: null,
                    error: new Error('rls denied'),
                  }),
                }),
              }),
            }),
          }),
        },
      } as unknown as StorefrontSitemapContext)
    ).rejects.toThrow('rls denied');
  });

  it('omits blog child sitemaps from the sitemap index when blog_enabled is false', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      feature_settings: { blog_enabled: false },
    });

    const { resolveStorefrontSitemapContext, getSitemapIndexLinks } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );
    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const links = await getSitemapIndexLinks(context);

    expect(links).toEqual([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
      'https://ogabassey.com/sitemap/categories.xml',
      'https://ogabassey.com/sitemap/brand-authority.xml',
      'https://ogabassey.com/sitemap/commercial-support.xml',
    ]);
  });

  it('keeps the core sitemap index links when the snapshot has no blog flag', () => {
    const { getSitemapIndexLinks } = sitemapData;

    const links = getSitemapIndexLinks({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {},
    } as unknown as StorefrontSitemapContext);

    expect(links).toEqual([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
      'https://ogabassey.com/sitemap/categories.xml',
      'https://ogabassey.com/sitemap/brand-authority.xml',
      'https://ogabassey.com/sitemap/commercial-support.xml',
    ]);
  });

  it('serializes sitemap XML responses with image namespace when needed', async () => {
    const { createSitemapResponse } = sitemapData;
    const response = createSitemapResponse([
      {
        url: 'https://ogabassey.com/smartphones/iphone-15',
        lastModified: new Date('2026-01-15T00:00:00Z'),
        changeFrequency: 'weekly',
        priority: 0.8,
        images: ['https://img.example.com/iphone.jpg'],
      },
    ]);
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(body).toContain('<urlset');
    expect(body).toContain('xmlns:image=');
    expect(body).toContain(
      '<image:loc>https://img.example.com/iphone.jpg</image:loc>'
    );
  });
});
