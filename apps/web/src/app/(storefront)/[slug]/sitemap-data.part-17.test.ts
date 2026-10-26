import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';

let _mockHeaders = new Map<string, string>();
const mockGetMerchantByIdentifier = vi.fn();
const mockGetCachedCategoryPageData = vi.fn();
const mockGetCachedCategoryProductCounts = vi.fn();
const mockGetBrandAuthorityCategory = vi.fn();
const mockGetCachedBrandAuthorityInventory = vi.fn();
const mockBuildCommercialSupportDiscoveryLinks = vi.fn();
const mockQueryResults = new Map<
  string,
  { data: unknown; error: Error | null }
>();
const mockSelectCalls: string[] = [];
let sitemapData: typeof import('./sitemap-data');

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
  getCachedCategoryPageData: (...args: unknown[]) =>
    mockGetCachedCategoryPageData(...args),
}));
vi.mock('@/lib/cached-category-product-counts', () => ({
  getCachedCategoryProductCounts: (...args: unknown[]) =>
    mockGetCachedCategoryProductCounts(...args),
}));
vi.mock('@/lib/storefront-category/brand-authority-public-data', () => ({
  brandAuthorityPublicData: {
    getCategory: (...args: unknown[]) => mockGetBrandAuthorityCategory(...args),
  },
}));
vi.mock(
  '@/lib/storefront-category/get-cached-brand-authority-inventory',
  () => ({
    getCachedBrandAuthorityInventory: (...args: unknown[]) =>
      mockGetCachedBrandAuthorityInventory(...args),
  })
);

vi.mock('@/lib/storefront-compare/build-compare-discovery-links', () => ({
  buildCommercialSupportDiscoveryLinks: (...args: unknown[]) =>
    mockBuildCommercialSupportDiscoveryLinks(...args),
}));

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

function createEq(table: string) {
  return vi.fn((...args: unknown[]) => {
    const [key, value] = args as [string, string];
    const response = mockQueryResults.get(table);
    const isTerminalQuery =
      (table === 'products' && key === 'status' && value === 'active') ||
      (table === 'categories' &&
        key === 'merchant_id' &&
        value === 'merchant-1');

    if (isTerminalQuery) {
      if (table === 'products') {
        const rows = Array.isArray(response?.data)
          ? (response?.data as unknown[])
          : [];

        return {
          data: rows,
          error: response?.error ?? null,
          order: vi.fn(() => ({
            order: vi.fn(() => ({
              range: (from: number, to: number) => ({
                data: rows.slice(from, to + 1),
                error: response?.error ?? null,
              }),
            })),
            range: (from: number, to: number) => ({
              data: rows.slice(from, to + 1),
              error: response?.error ?? null,
            }),
          })),
          range: (from: number, to: number) => ({
            data: rows.slice(from, to + 1),
            error: response?.error ?? null,
          }),
        };
      }

      return {
        data: response?.data ?? [],
        error: response?.error ?? null,
      };
    }

    return { eq: createEq(table) };
  });
}

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(() => ({
    from: (table: string) => ({
      select: (columns?: string) => {
        if (columns) {
          mockSelectCalls.push(columns);
        }

        return {
          eq: createEq(table),
        };
      },
    }),
  })),
}));

function _setCustomDomainHeader(domain: string) {
  _mockHeaders = new Map<string, string>([['x-custom-domain', domain]]);
}

function _setMerchantDomainHeader(domain: string) {
  _mockHeaders = new Map<string, string>([['x-merchant-domain', domain]]);
}

function _setHostHeader(host: string) {
  _mockHeaders = new Map<string, string>([['host', host]]);
}

function _mockProductsQuery(data: unknown, error: Error | null = null) {
  mockQueryResults.set('products', { data, error });
}

function _mockCategoriesQuery(data: unknown, error: Error | null = null) {
  mockQueryResults.set('categories', { data, error });
}

describe('sitemap-data', () => {
  beforeAll(async () => {
    sitemapData = await import('./sitemap-data');
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    _mockHeaders = new Map();
    mockQueryResults.clear();
    mockSelectCalls.length = 0;
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      feature_settings: { blog_enabled: true },
    });
    mockGetCachedCategoryPageData.mockReset();
    mockGetCachedCategoryPageData.mockResolvedValue(null);
    mockGetCachedCategoryProductCounts.mockReset();
    mockGetBrandAuthorityCategory.mockReset();
    mockGetBrandAuthorityCategory.mockResolvedValue(null);
    mockGetCachedBrandAuthorityInventory.mockReset();
    mockGetCachedBrandAuthorityInventory.mockResolvedValue({
      latestUpdatedAt: null,
      productCount: 0,
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReset();
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([]);
  });

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
