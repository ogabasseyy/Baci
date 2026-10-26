import { describe, expect, it, vi } from 'vitest';
import { getCachedCategoryPageData } from '@/lib/cached-data';
import { loadCategoryPageDataSafely } from './load-category-page-data-safely';

vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageData: vi.fn(),
}));

const mockGet = vi.mocked(getCachedCategoryPageData);

describe('loadCategoryPageDataSafely', () => {
  it('returns category page data on success', async () => {
    const data = { products: [] };
    mockGet.mockResolvedValue(data as never);
    await expect(
      loadCategoryPageDataSafely({
        merchantId: 'merchant-1',
        categorySlug: 'smartphones',
        storeSlug: 'ogabassey',
      })
    ).resolves.toEqual(data);
  });

  it('returns null instead of throwing on failure', async () => {
    mockGet.mockRejectedValue(new Error('category unavailable'));
    await expect(
      loadCategoryPageDataSafely({
        merchantId: 'merchant-1',
        categorySlug: 'smartphones',
        storeSlug: 'ogabassey',
      })
    ).resolves.toBeNull();
  });
});
