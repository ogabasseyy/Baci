import { beforeAll, beforeEach, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';

export let mockHeaders = new Map<string, string>();
export const mockGetMerchantByIdentifier = vi.fn();
export const mockGetCachedCategoryPageData = vi.fn();
export const mockGetCachedCategoryProductCounts = vi.fn();
export const mockGetBrandAuthorityCategory = vi.fn();
export const mockGetCachedBrandAuthorityInventory = vi.fn();
export const mockBuildCommercialSupportDiscoveryLinks = vi.fn();
export const mockQueryResults = new Map<
  string,
  { data: unknown; error: Error | null }
>();
export const mockSelectCalls: string[] = [];
export let sitemapData: typeof import('./sitemap-data');

// Shared module mocks for every sitemap-data partition. Factories delegate
// to the mock fns above so module shapes change in exactly one place.
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

export function createEq(table: string) {
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

export function _setCustomDomainHeader(domain: string) {
  mockHeaders = new Map<string, string>([['x-custom-domain', domain]]);
}

export function _setMerchantDomainHeader(domain: string) {
  mockHeaders = new Map<string, string>([['x-merchant-domain', domain]]);
}

export function _setHostHeader(host: string) {
  mockHeaders = new Map<string, string>([['host', host]]);
}

export function _mockProductsQuery(data: unknown, error: Error | null = null) {
  mockQueryResults.set('products', { data, error });
}

export function mockCategoriesQuery(data: unknown, error: Error | null = null) {
  mockQueryResults.set('categories', { data, error });
}

export function registerSitemapDataTests() {
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
}

export {
  _mockProductsQuery as mockProductsQuery,
  _setCustomDomainHeader as setCustomDomainHeader,
  _setHostHeader as setHostHeader,
  _setMerchantDomainHeader as setMerchantDomainHeader,
  mockHeaders as _mockHeaders,
};
