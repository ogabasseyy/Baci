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

  it('keeps an over-cap hub toggle intact via a validated hub token', async () => {
    const available = Array.from({ length: 10 }, (_, i) => `RTX 4070 rev${i}`);
    mockGetGraphicsOptions.mockResolvedValueOnce(available);
    const remaining = available.slice(1);

    const result = await loadFilteredCategoryPageData({
      category: 'gaming-laptops',
      merchantId: 'merchant-1',
      productLimit: 20,
      productOffset: 0,
      rawGraphics: remaining,
      storeSlug: 'demo-store',
      trustedHubSlug: 'rtx-4070',
    });

    expect(result.selectedGraphics).toHaveLength(9);
  });

  it('applies the request cap when the hub token is unknown', async () => {
    const available = Array.from({ length: 10 }, (_, i) => `RTX 4070 rev${i}`);
    mockGetGraphicsOptions.mockResolvedValueOnce(available);

    const result = await loadFilteredCategoryPageData({
      category: 'gaming-laptops',
      merchantId: 'merchant-1',
      productLimit: 20,
      productOffset: 0,
      rawGraphics: available.slice(1),
      storeSlug: 'demo-store',
      trustedHubSlug: 'rtx-9999',
    });

    expect(result.selectedGraphics).toHaveLength(8);
  });

  it('passes the full trusted hub selection through without the request cap', async () => {
    const available = Array.from({ length: 10 }, (_, i) => `GPU ${i}`);
    mockGetGraphicsOptions.mockResolvedValueOnce(available);

    const result = await loadFilteredCategoryPageData({
      category: 'gaming-laptops',
      merchantId: 'merchant-1',
      productLimit: 20,
      productOffset: 0,
      rawGraphics: available,
      storeSlug: 'demo-store',
      trustedGraphics: true,
    });

    expect(result.selectedGraphics).toHaveLength(10);
    expect(mockGetData).toHaveBeenLastCalledWith(
      'merchant-1',
      'gaming-laptops',
      'demo-store',
      0,
      20,
      { graphics: result.selectedGraphics }
    );
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
