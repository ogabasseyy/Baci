import { beforeAll, beforeEach, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';

export let _mockHeaders = new Map<string, string>();
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
  _mockHeaders = new Map<string, string>([['x-custom-domain', domain]]);
}

export function _setMerchantDomainHeader(domain: string) {
  _mockHeaders = new Map<string, string>([['x-merchant-domain', domain]]);
}

export function _setHostHeader(host: string) {
  _mockHeaders = new Map<string, string>([['host', host]]);
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
}
