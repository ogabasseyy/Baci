import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

function mockCategoriesQuery(data: unknown, error: Error | null = null) {
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

  it('deduplicates commercial-support URLs across category batches', async () => {
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
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
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
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([
      {
        href: 'https://ogabassey.com/smartphones/compare/a-vs-b',
        label: 'A vs B',
      },
    ]);
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

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/compare/a-vs-b',
      }),
    ]);
  });

  it('resolves slug from request host when headersList is empty and override is undefined', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'hhjjk',
    });
    const { resolveStorefrontSitemapContext } = sitemapData;
    const emptyHeaders = new Headers();
    const req = new Request('https://hhjjk.usebaci.com/sitemap.xml');

    const context = await resolveStorefrontSitemapContext(
      emptyHeaders,
      undefined,
      req
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('hhjjk');
    expect(context?.merchant.slug).toBe('hhjjk');
  });
});
