import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { getStorefrontSearchProducts } from '@/lib/storefront-search';

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

describe('loadSearchPageData', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    mockGetStorefrontSearchProducts.mockReset();
    mockHeaders.mockReset();
    mockNotFound.mockReset();
  });

  it('loads a submission entry and tracks it as a new search', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce(
      searchPage() as never
    );

    const data = await loadSearch({ q: 'iphone' });

    expect(data).toMatchObject({
      query: 'iphone',
      page: 1,
      redirectHref: null,
      searchFailed: false,
      searchBasePath: '/ogabassey/search',
    });
    expect(data.searchResult?.products).toHaveLength(20);
    expect(data.merchant).toMatchObject({ id: 'merchant-1' });
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, trackAnalytics: true })
    );
  });

  it('does not track an explicit page-1 navigation', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce(
      searchPage() as never
    );

    const data = await loadSearch({ q: 'iphone', page: '1' });

    expect(data.page).toBe(1);
    expect(data.redirectHref).toBeNull();
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, trackAnalytics: false })
    );
  });

  it('fetches deeper pages untracked at the bounded offset', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce(
      searchPage() as never
    );

    const data = await loadSearch({ q: 'iphone', page: '2' });

    expect(data.page).toBe(2);
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 20, trackAnalytics: false })
    );
  });

  it('redirects a malformed page to the explicit first page without fetching', async () => {
    mockStorefrontContext();

    const data = await loadSearch({ q: 'iphone', page: 'abc' });

    expect(data.redirectHref).toBe('/ogabassey/search?q=iphone&page=1');
    expect(mockGetStorefrontSearchProducts).not.toHaveBeenCalled();
  });

  it('collapses a page without a query to the plain route', async () => {
    mockStorefrontContext();

    const data = await loadSearch({ page: '2' });

    expect(data.query).toBe('');
    expect(data.redirectHref).toBe('/ogabassey/search');
    expect(mockGetStorefrontSearchProducts).not.toHaveBeenCalled();
  });

  it('resolves an overbound page to the last page through a probe', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockResolvedValueOnce(
      searchPage({ count: 45, products: [], productIds: [] }) as never
    );

    const data = await loadSearch({ q: 'iphone', page: '101' });

    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledTimes(1);
    expect(mockGetStorefrontSearchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, trackAnalytics: false })
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

  it('reports search failure without redirecting when the fetch throws', async () => {
    mockStorefrontContext();
    mockGetStorefrontSearchProducts.mockRejectedValueOnce(
      new Error('search exploded')
    );

    const data = await loadSearch({ q: 'iphone' });

    expect(data.searchFailed).toBe(true);
    expect(data.searchResult).toBeNull();
    expect(data.redirectHref).toBeNull();
  });

  it('renders not found for an invalid slug', async () => {
    mockNotFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND');
    });

    await expect(
      loadSearchPageData({
        params: Promise.resolve({ slug: 'not a slug!!' }),
        searchParams: Promise.resolve({ q: 'iphone' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('renders not found when the merchant does not resolve', async () => {
    mockHeaders.mockResolvedValue(new Headers());
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(null);
    mockNotFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND');
    });

    await expect(loadSearch({ q: 'iphone' })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });
});
