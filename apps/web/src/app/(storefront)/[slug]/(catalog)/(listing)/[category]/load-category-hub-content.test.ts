import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCategoryHubContent } from './load-category-hub-content';

const mockAuthority = vi.fn();
const mockGuides = vi.fn();
const mockCategoryPageData = vi.fn();
const mockCompareInventory = vi.fn();

vi.mock('@/lib/storefront-category/get-cached-brand-authority-entries', () => ({
  getCachedBrandAuthorityEntries: (...args: unknown[]) =>
    mockAuthority(...args),
}));
vi.mock('@/lib/storefront-content/load-published-cluster-posts-safely', () => ({
  loadPublishedClusterPostsSafely: (...args: unknown[]) => mockGuides(...args),
}));
vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageData: (...args: unknown[]) =>
    mockCategoryPageData(...args),
}));
vi.mock(
  '@/lib/storefront-compare/load-compare-category-inventory-safely',
  () => ({
    loadCompareCategoryInventorySafely: (...args: unknown[]) =>
      mockCompareInventory(...args),
  })
);

describe('loadCategoryHubContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthority.mockResolvedValue(['authority']);
    mockGuides.mockResolvedValue(['guide']);
    mockCategoryPageData.mockResolvedValue(null);
    mockCompareInventory.mockResolvedValue(null);
  });

  it('loads supported guides and authority entries for a public category and fails closed to empty compareProducts when compare inventory is unavailable', async () => {
    await expect(
      loadCategoryHubContent({
        merchantId: 'merchant-1',
        categorySlug: 'smartphones',
        categoryData: {
          isCollection: false,
          isInactiveCategory: false,
          category: { id: 'cat-1' },
        },
      } as never)
    ).resolves.toEqual({
      guidePosts: ['guide'],
      brandAuthorityEntries: ['authority'],
      compareProducts: [],
    });
  });

  it('skips authority inventory for collections', async () => {
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      categoryData: { isCollection: true, category: null },
    } as never);
    expect(result.brandAuthorityEntries).toEqual([]);
    expect(mockAuthority).not.toHaveBeenCalled();
    expect(mockCategoryPageData).not.toHaveBeenCalled();
  });

  it('loads 150-product canonical pool when storeSlug is provided', async () => {
    mockCategoryPageData.mockResolvedValue({
      products: [{ id: 'prod-1', name: 'Product 1' }],
      productsQueryFailed: false,
    });
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: { id: 'cat-1' },
        productCount: 50,
        products: [{ id: 'p-initial' }],
      },
      storeSlug: 'ogabassey',
    } as never);
    expect(mockCategoryPageData).toHaveBeenCalledWith(
      'merchant-1',
      'smartphones',
      'ogabassey',
      0,
      150
    );
    expect(result.hubProducts).toEqual([{ id: 'prod-1', name: 'Product 1' }]);
  });

  it('skips 150-product fetch for non-priority categories without hub defaults', async () => {
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'headphones',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: { id: 'cat-hp' },
        productCount: 50,
        products: [{ id: 'p-hp' }],
      },
      storeSlug: 'ogabassey',
    } as never);
    expect(mockCategoryPageData).not.toHaveBeenCalled();
    expect(result.hubProducts).toBeUndefined();
  });

  it('reuses loaded page data without an extra fetch when products already cover the count', async () => {
    const pageProducts = [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ];
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: { id: 'cat-1' },
        productCount: 2,
        products: pageProducts,
      },
      storeSlug: 'ogabassey',
    } as never);
    expect(mockCategoryPageData).not.toHaveBeenCalled();
    expect(result.hubProducts).toEqual(pageProducts);
  });

  it('loads 150-product canonical pool for legacy categories without a category row', async () => {
    mockCategoryPageData.mockResolvedValue({
      products: [{ id: 'prod-legacy', name: 'Legacy Product' }],
      productsQueryFailed: false,
    });
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: null,
        productCount: 80,
        products: [{ id: 'p-init' }],
      },
      storeSlug: 'ogabassey',
    } as never);
    expect(result.brandAuthorityEntries).toEqual([]);
    expect(mockAuthority).not.toHaveBeenCalled();
    expect(mockCategoryPageData).toHaveBeenCalledWith(
      'merchant-1',
      'smartphones',
      'ogabassey',
      0,
      150
    );
    expect(result.hubProducts).toEqual([
      { id: 'prod-legacy', name: 'Legacy Product' },
    ]);
  });

  it('skips authority and guide queries when includeAuthorityContent is false', async () => {
    mockCategoryPageData.mockResolvedValue({
      products: [{ id: 'prod-pool', name: 'Pool Product' }],
      productsQueryFailed: false,
    });
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: { id: 'cat-1' },
        productCount: 80,
        products: [{ id: 'p-init' }],
      },
      storeSlug: 'ogabassey',
      includeAuthorityContent: false,
    } as never);
    expect(result.guidePosts).toEqual([]);
    expect(result.brandAuthorityEntries).toEqual([]);
    expect(mockGuides).not.toHaveBeenCalled();
    expect(mockAuthority).not.toHaveBeenCalled();
    expect(result.hubProducts).toEqual([
      { id: 'prod-pool', name: 'Pool Product' },
    ]);
  });

  it('logs warning when hub pool fetch fails and fails closed to empty array', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCategoryPageData.mockRejectedValue(
      new Error('DB connection timed out')
    );
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: { id: 'cat-1' },
        productCount: 80,
        products: [{ id: 'p-init' }],
      },
      storeSlug: 'ogabassey',
    } as never);
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to load canonical category hub products',
      expect.objectContaining({
        merchantId: 'merchant-1',
        categorySlug: 'smartphones',
        error: expect.any(Error),
      })
    );
    expect(result.hubProducts).toEqual([]);
    warnSpy.mockRestore();
  });

  it('does not treat prototype properties as hub default categories', async () => {
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'constructor',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: { id: 'cat-proto' },
        productCount: 10,
        products: [{ id: 'p1' }],
      },
      storeSlug: 'ogabassey',
    } as never);
    expect(mockCategoryPageData).not.toHaveBeenCalled();
    expect(result.hubProducts).toBeUndefined();
  });
});
