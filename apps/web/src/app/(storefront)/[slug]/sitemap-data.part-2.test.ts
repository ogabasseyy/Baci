import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

function setHostHeader(host: string) {
  mockHeaders = new Map<string, string>([['host', host]]);
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

  it('falls back to the explicit slug when the request host is not a merchant domain', async () => {
    setHostHeader('preview.usebaci.com');
    mockGetMerchantByIdentifier
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
      });
    const { resolveStorefrontSitemapContext } = sitemapData;

    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers,
      'ogabassey'
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(1, 'preview');
    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(2, 'ogabassey');
    expect(context?.merchant.slug).toBe('ogabassey');
  });

  it('allows a real merchant slug named sitemap without header context', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-sitemap',
      slug: 'sitemap',
    });
    const { resolveStorefrontSitemapContext } = sitemapData;

    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers,
      'sitemap'
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('sitemap');
    expect(context?.merchant.slug).toBe('sitemap');
  });

  it('returns static sitemap entries for the storefront root and faq', () => {
    const { getStaticSitemapEntries } = sitemapData;
    const entries = getStaticSitemapEntries({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
        updated_at: '2026-06-01T00:00:00Z',
      },
      storeUrl: 'https://ogabassey.com',
    } as unknown as Parameters<typeof getStaticSitemapEntries>[0]);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com',
        priority: 1,
        lastModified: new Date('2026-06-01T00:00:00Z'),
      }),
      expect.objectContaining({
        url: 'https://ogabassey.com/products',
        priority: 0.9,
        lastModified: new Date('2026-06-01T00:00:00Z'),
      }),
      expect.objectContaining({
        url: 'https://ogabassey.com/faq',
        priority: 0.5,
        lastModified: new Date('2026-06-01T00:00:00Z'),
      }),
    ]);
  });

  it('omits lastmod from static entries when the merchant has no updated_at', () => {
    const { getStaticSitemapEntries } = sitemapData;
    const entries = getStaticSitemapEntries({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
      },
      storeUrl: 'https://ogabassey.com',
    } as unknown as Parameters<typeof getStaticSitemapEntries>[0]);

    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.lastModified).toBeUndefined();
    }
  });
});
