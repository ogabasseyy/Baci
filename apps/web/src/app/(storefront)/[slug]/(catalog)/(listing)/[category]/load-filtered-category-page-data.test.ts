import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetData, mockGetGraphicsOptions } = vi.hoisted(() => ({
  mockGetData: vi.fn(),
  mockGetGraphicsOptions: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageData: (...args: unknown[]) => mockGetData(...args),
  getCachedCategoryPageGraphicsOptions: (...args: unknown[]) =>
    mockGetGraphicsOptions(...args),
}));

import { loadFilteredCategoryPageData } from './load-filtered-category-page-data';

describe('loadFilteredCategoryPageData', () => {
  beforeEach(() => {
    mockGetData.mockReset();
    mockGetGraphicsOptions.mockReset();
    mockGetData.mockResolvedValue({ products: [] });
    mockGetGraphicsOptions.mockResolvedValue(['NVIDIA RTX 4070']);
  });

  it('loads the normal page and then the allowlisted filtered page', async () => {
    const result = await loadFilteredCategoryPageData({
      category: 'gaming-laptops',
      merchantId: 'merchant-1',
      productLimit: 20,
      productOffset: 20,
      rawGraphics: 'NVIDIA RTX 4070',
      storeSlug: 'demo-store',
    });

    expect(mockGetData).toHaveBeenLastCalledWith(
      'merchant-1',
      'gaming-laptops',
      'demo-store',
      20,
      20,
      { graphics: ['NVIDIA RTX 4070'] }
    );
    expect(result.selectedGraphics).toEqual(['NVIDIA RTX 4070']);
  });

  it('does not create a filtered cache entry for an unknown query value', async () => {
    await loadFilteredCategoryPageData({
      category: 'gaming-laptops',
      merchantId: 'merchant-1',
      productLimit: 20,
      productOffset: 0,
      rawGraphics: 'Unknown GPU',
      storeSlug: 'demo-store',
    });

    expect(mockGetData).toHaveBeenCalledOnce();
  });
});
