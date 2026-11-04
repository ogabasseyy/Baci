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

describe('loadCategoryHubContent - non-hub and filtered categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthority.mockResolvedValue([]);
    mockGuides.mockResolvedValue([]);
    mockCategoryPageData.mockResolvedValue(null);
    mockCompareInventory.mockResolvedValue({ products: [] });
  });

  it('leaves hubProducts undefined for non-hub categories on filtered pages', async () => {
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'non-hub-category',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: { id: 'cat-non-hub' },
        productCount: 5,
        products: [{ id: 'p-1', name: 'Product 1' }],
      },
      storeSlug: 'demo-store',
      isFiltered: true,
    } as never);

    expect(mockCategoryPageData).not.toHaveBeenCalled();
    expect(result.hubProducts).toBeUndefined();
  });

  it('fails closed to empty hubProducts for hub categories on filtered pages when canonical fetch fails', async () => {
    mockCategoryPageData.mockResolvedValue(null);

    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: { id: 'cat-phones' },
        productCount: 10,
        products: [{ id: 'filtered-1', name: 'Filtered Phone' }],
      },
      storeSlug: 'demo-store',
      isFiltered: true,
    } as never);

    expect(mockCategoryPageData).toHaveBeenCalledWith(
      'merchant-1',
      'smartphones',
      'demo-store',
      0,
      150
    );
    expect(result.hubProducts).toEqual([]);
  });

  it('fetches 150-product canonical pool when page is filtered even if page productCount is covered', async () => {
    mockCategoryPageData.mockResolvedValue({
      products: [{ id: 'canonical-pool-product', name: 'Canonical' }],
      productsQueryFailed: false,
    });
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: { id: 'cat-1' },
        productCount: 2,
        products: [{ id: 'filtered-1' }, { id: 'filtered-2' }],
      },
      storeSlug: 'ogabassey',
      isFiltered: true,
    } as never);
    expect(mockCategoryPageData).toHaveBeenCalledWith(
      'merchant-1',
      'smartphones',
      'ogabassey',
      0,
      150
    );
    expect(result.hubProducts).toEqual([
      { id: 'canonical-pool-product', name: 'Canonical' },
    ]);
  });

  it('caps reused page products to the first 150 when productCount exceeds 150', async () => {
    const manyProducts = Array.from({ length: 200 }, (_, i) => ({
      id: `p-${i}`,
      name: `Product ${i}`,
    }));
    const result = await loadCategoryHubContent({
      merchantId: 'merchant-1',
      categorySlug: 'smartphones',
      categoryData: {
        isCollection: false,
        isInactiveCategory: false,
        category: { id: 'cat-1' },
        productCount: 200,
        products: manyProducts,
      },
      storeSlug: 'ogabassey',
    } as never);
    expect(mockCategoryPageData).not.toHaveBeenCalled();
    expect(result.hubProducts).toHaveLength(150);
    expect(result.hubProducts?.[0]?.id).toBe('p-0');
    expect(result.hubProducts?.[149]?.id).toBe('p-149');
  });
});
