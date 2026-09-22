import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetData, mockGetGraphicsOptions } = vi.hoisted(() => ({
  mockGetData: vi.fn(),
  mockGetGraphicsOptions: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageData: (...args: unknown[]) => mockGetData(...args),
  getCachedCategoryPageGraphicsOptions: (...args: unknown[]) =>
    mockGetGraphicsOptions(...args),
  getCachedCategoryPageGraphicsOptionsStrict: (...args: unknown[]) =>
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

  it('fails closed instead of falling back to unfiltered data when the facet read fails', async () => {
    mockGetData.mockResolvedValueOnce({
      products: [{ id: 'unfiltered-product' }],
    });
    mockGetGraphicsOptions.mockRejectedValueOnce(
      new Error('facet query failed')
    );

    const result = await loadFilteredCategoryPageData({
      category: 'gaming-laptops',
      merchantId: 'merchant-1',
      productLimit: 20,
      productOffset: 0,
      rawGraphics: 'NVIDIA RTX 4070',
      storeSlug: 'demo-store',
    });

    expect(result.graphicsOptions).toEqual([]);
    expect(result.selectedGraphics).toEqual([]);
    expect(result.graphicsOptionsFailed).toBe(true);
    expect(result.data.products).toEqual([]);
    expect(result.data.productsQueryFailed).toBe(true);
    expect(result.data.productIdsQueryFailed).toBe(true);
    // Only the initial unfiltered read ran; no filtered re-read happened.
    expect(mockGetData).toHaveBeenCalledOnce();
  });

  it('still serves the unfiltered listing when no filter was requested and the facet read fails', async () => {
    mockGetData.mockResolvedValueOnce({
      products: [{ id: 'unfiltered-product' }],
    });
    mockGetGraphicsOptions.mockRejectedValueOnce(
      new Error('facet query failed')
    );

    const result = await loadFilteredCategoryPageData({
      category: 'gaming-laptops',
      merchantId: 'merchant-1',
      productLimit: 20,
      productOffset: 0,
      rawGraphics: undefined,
      storeSlug: 'demo-store',
    });

    expect(result.data.products).toEqual([{ id: 'unfiltered-product' }]);
    expect(result.graphicsOptions).toEqual([]);
    expect(result.graphicsOptionsFailed).toBe(true);
  });
});
