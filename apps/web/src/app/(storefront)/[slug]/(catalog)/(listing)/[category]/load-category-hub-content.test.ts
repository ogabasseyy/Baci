import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthority = vi.fn();
const mockGuides = vi.fn();
const mockCategoryPageData = vi.fn();

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

describe('loadCategoryHubContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthority.mockResolvedValue(['authority']);
    mockGuides.mockResolvedValue(['guide']);
    mockCategoryPageData.mockResolvedValue(null);
  });

  it('loads supported guides and authority entries for a public category', async () => {
    const { loadCategoryHubContent } = await import(
      './load-category-hub-content'
    );
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
    });
  });

  it('skips authority inventory for collections', async () => {
    const { loadCategoryHubContent } = await import(
      './load-category-hub-content'
    );
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
    const { loadCategoryHubContent } = await import(
      './load-category-hub-content'
    );
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: { id: 'cat-1' },
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
});
