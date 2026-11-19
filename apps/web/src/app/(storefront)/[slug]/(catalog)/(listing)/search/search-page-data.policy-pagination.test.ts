import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { getStorefrontSearchProducts } from '@/lib/storefront-search';
import { getStorefrontSearchFacets } from '@/lib/storefront-search-refined-products';

const { mockNotFound } = vi.hoisted(() => ({
  mockNotFound: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: (...args: unknown[]) => mockNotFound(...args),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: vi.fn(),
  getStorefrontSearchProducts: vi.fn(),
}));

vi.mock('@/lib/storefront-search-refined-products', () => ({
  getStorefrontSearchFacets: vi.fn(),
}));

const mockHeaders = vi.fn();
vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

const { loadSearchPageData } = await import('./search-page-data');
const mockGetStorefrontSearchProducts = vi.mocked(getStorefrontSearchProducts);

function mockStorefrontContext() {
  mockHeaders.mockResolvedValue(
    new Headers([
      ['host', 'proxy.internal'],
      ['x-pathname', '/ogabassey/search'],
    ])
  );

  vi.mocked(getRequestScopedMerchant).mockResolvedValue({
    id: 'merchant-1',
    slug: 'ogabassey',
    custom_domain: null,
    business_name: 'Ogabassey',
    payout_currency: 'NGN',
  } as never);
}

function loadSearch(
  searchParams: Record<string, string | string[] | undefined> = {}
) {
  return loadSearchPageData({
    params: Promise.resolve({ slug: 'ogabassey' }),
    searchParams: Promise.resolve(searchParams),
  });
}

function searchPage(
  overrides: Record<string, unknown> = {},
  productCount = 20
) {
  return {
    count: 45,
    didYouMean: null,
    products: Array.from({ length: productCount }, (_, index) => ({
      id: `product-${index + 1}`,
    })),
    productIds: [],
    query: 'iphone',
    ...overrides,
  };
}

describe('loadSearchPageData - policy pagination and probe clamping', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    mockGetStorefrontSearchProducts.mockReset();
    mockHeaders.mockReset();
    vi.mocked(getStorefrontSearchFacets).mockReset();
    vi.mocked(getStorefrontSearchFacets).mockResolvedValue({
      brands: [],
      categories: [],
      conditions: [],
      minPrice: null,
      maxPrice: null,
    });
    mockNotFound.mockReset();
  });

  it('resolves an overbound page to the last page through a probe', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce(
      searchPage({ count: 45, products: [], productIds: [] }) as never
    );

    const data = await loadSearch({ q: 'iphone', page: '101' });

    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledTimes(1);
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 })
    );
    expect(data.redirectHref).toBe('/ogabassey/search?q=iphone&page=3');
  });

  it('normalizes an empty page beyond the first to the explicit first page', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts
      .mockResolvedValueOnce(
        searchPage({ count: 45, products: [], productIds: [] }) as never
      )
      .mockResolvedValueOnce(
        searchPage({ count: 0, products: [], productIds: [] }) as never
      );

    const data = await loadSearch({ q: 'iphon', page: '2' });

    expect(data.redirectHref).toBe('/ogabassey/search?q=iphon&page=1');
  });

  it('preserves an in-range intermediate page whose matches were policy-filtered', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce(
      searchPage({
        count: 0,
        totalCount: 45,
        products: [],
        productIds: [],
      }) as never
    );

    const data = await loadSearch({ q: 'iphone', page: '2' });

    expect(data.page).toBe(2);
    expect(data.redirectHref).toBeNull();
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledTimes(1);
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 20 })
    );
  });

  it('clamps overbound pages on the unadjusted probe total', async () => {
    mockStorefrontContext();
    // One first-page row vanished mid-read: the visible count is a full
    // page short of the ranked total, but the last page still holds rows.
    mockGetStorefrontSearchProducts.mockResolvedValueOnce(
      searchPage({
        count: 20,
        totalCount: 21,
        products: [],
        productIds: [],
      }) as never
    );

    const data = await loadSearch({ q: 'iphone', page: '101' });

    expect(data.redirectHref).toBe('/ogabassey/search?q=iphone&page=2');
  });

  it('steps an invalid page back instead of looping on it', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts
      .mockResolvedValueOnce(
        searchPage({ count: 45, products: [], productIds: [] }) as never
      )
      .mockResolvedValueOnce(
        searchPage({ count: 45, products: [], productIds: [] }) as never
      );

    const data = await loadSearch({ q: 'iphone', page: '5' });

    expect(data.redirectHref).toBe('/ogabassey/search?q=iphone&page=3');
  });
});
