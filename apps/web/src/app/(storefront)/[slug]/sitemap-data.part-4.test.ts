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

function setCustomDomainHeader(domain: string) {
  mockHeaders = new Map<string, string>([['x-custom-domain', domain]]);
}

function _setMerchantDomainHeader(domain: string) {
  mockHeaders = new Map<string, string>([['x-merchant-domain', domain]]);
}

function _setHostHeader(host: string) {
  mockHeaders = new Map<string, string>([['host', host]]);
}

function mockProductsQuery(data: unknown, error: Error | null = null) {
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

  it('paginates product sitemap queries beyond the Supabase 1000 row default', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      is_published: true,
    });

    mockProductsQuery(
      Array.from({ length: 1002 }, (_, index) => ({
        id: `p${index + 1}`,
        name: `Product ${index + 1}`,
        slug: `product-${index + 1}`,
        category: 'Smartphones',
        images: [],
        updated_at: '2026-01-15T00:00:00Z',
        category_id: 'cat-1',
        category_slug: null,
        categories: { slug: 'smartphones' },
      }))
    );

    const { resolveStorefrontSitemapContext, getProductSitemapEntries } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getProductSitemapEntries(context);

    expect(entries).toHaveLength(1002);
    expect(entries[1001]?.url).toBe(
      'https://ogabassey.com/smartphones/product-1002'
    );
  });

  it('falls back to /products path when category slug is missing', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      is_published: true,
    });
    mockProductsQuery([
      {
        id: 'p2',
        name: 'MacBook Pro M4 Max',
        slug: 'macbook-pro-m4-max-36gb-1tb-16-inch',
        category: 'Laptops',
        images: [],
        updated_at: '2026-01-16T00:00:00Z',
        category_id: null,
        category_slug: null,
        categories: null,
      },
    ]);
    const { resolveStorefrontSitemapContext, getProductSitemapEntries } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );
    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getProductSitemapEntries(context);

    expect(entries[0]).toMatchObject({
      url: 'https://ogabassey.com/products/macbook-pro-m4-max-36gb-1tb-16-inch',
    });
  });
});
