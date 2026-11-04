import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCategoryHubContent } from './load-category-hub-content';

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

describe('loadCategoryHubContent - non-hub and filtered categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthority.mockResolvedValue([]);
    mockGuides.mockResolvedValue([]);
    mockCategoryPageData.mockResolvedValue(null);
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
});
