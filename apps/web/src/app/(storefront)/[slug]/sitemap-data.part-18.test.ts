import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';

let mockHeaders = new Map<string, string>();
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
  mockHeaders = new Map<string, string>([['x-custom-domain', domain]]);
}

function _setMerchantDomainHeader(domain: string) {
  mockHeaders = new Map<string, string>([['x-merchant-domain', domain]]);
}

function _setHostHeader(host: string) {
  mockHeaders = new Map<string, string>([['host', host]]);
}

function _mockProductsQuery(data: unknown, error: Error | null = null) {
  mockQueryResults.set('products', { data, error });
}

function mockCategoriesQuery(data: unknown, error: Error | null = null) {
  mockQueryResults.set('categories', { data, error });
}

describe('sitemap-data', () => {
  beforeAll(async () => {
    sitemapData = await import('./sitemap-data');
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders = new Map();
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

  it('omits lastmod from commercial-support entries when the category has no timestamp', async () => {
    mockCategoriesQuery([{ slug: 'smartphones', updated_at: null }]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([
      {
        href: 'https://ogabassey.com/smartphones/compare/a-vs-b',
        label: 'A vs B',
      },
      {
        href: 'https://ogabassey.com/smartphones/compare/a-vs-c',
        label: 'A vs C',
      },
    ]);
    const { getCommercialSupportSitemapEntries } = sitemapData;

    const entries = await getCommercialSupportSitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: (table: string) => ({
          select: () => ({ eq: createEq(table) }),
        }),
      },
    } as unknown as StorefrontSitemapContext);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/compare/a-vs-b',
      }),
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/compare/a-vs-c',
      }),
    ]);
    expect(entries[0]?.lastModified).toBeUndefined();
  });

  it('creates sitemap unavailable response with 503, no-store, and retry-after', () => {
    const { createSitemapUnavailableResponse } = sitemapData;
    const response = createSitemapUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('300');
  });

  it('creates sitemap not-found response with 404 and no retry header', () => {
    const { createSitemapNotFoundResponse } = sitemapData;
    const response = createSitemapNotFoundResponse();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBeNull();
  });

  it('marks transient storefront sitemap lookup failures as unavailable', async () => {
    mockGetMerchantByIdentifier.mockRejectedValueOnce(
      new Error('Database timeout')
    );
    const { resolveStorefrontSitemapContextResult } = sitemapData;

    const result = await resolveStorefrontSitemapContextResult(
      mockHeaders as unknown as Headers,
      'test-store',
      new Request('https://test-store.usebaci.com/sitemap/static.xml')
    );

    expect(result.status).toBe('unavailable');
  });

  it('distinguishes missing storefront sitemaps from transient lookup failures', async () => {
    mockGetMerchantByIdentifier.mockResolvedValueOnce(null);
    const { resolveStorefrontSitemapContextResult } = sitemapData;

    const result = await resolveStorefrontSitemapContextResult(
      mockHeaders as unknown as Headers,
      'test-store',
      new Request('https://test-store.usebaci.com/sitemap/static.xml')
    );

    expect(result.status).toBe('not-found');
  });
});
