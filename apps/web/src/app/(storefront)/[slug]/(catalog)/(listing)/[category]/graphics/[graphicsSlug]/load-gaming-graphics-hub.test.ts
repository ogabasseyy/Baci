import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetData, mockGetGraphicsOptions, mockGetMerchant } = vi.hoisted(
  () => ({
    mockGetData: vi.fn(),
    mockGetGraphicsOptions: vi.fn(),
    mockGetMerchant: vi.fn(),
  })
);

vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageData: (...args: unknown[]) => mockGetData(...args),
  getCachedCategoryPageGraphicsOptions: (...args: unknown[]) =>
    mockGetGraphicsOptions(...args),
  getMerchantByIdentifier: (...args: unknown[]) => mockGetMerchant(...args),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://ogabassey.com',
}));

import { loadGamingGraphicsHub } from './load-gaming-graphics-hub';

describe('loadGamingGraphicsHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMerchant.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Ogabassey',
      country: 'NG',
    });
    mockGetGraphicsOptions.mockResolvedValue([
      '8GB RTX 4070 Graphics',
      'NVIDIA GeForce RTX 4070 8GB',
      'RTX 4070 Ti',
    ]);
    mockGetData.mockResolvedValue({
      productCount: 12,
      products: [{ id: 'product-1' }],
      productsQueryFailed: false,
    });
  });

  it('loads the curated hub with every matching raw inventory value', async () => {
    const page = await loadGamingGraphicsHub({
      categorySlug: 'gaming-laptops',
      currentPage: 1,
      graphicsSlug: 'rtx-4070',
      merchantSlug: 'ogabassey.com',
    });

    expect(mockGetData).toHaveBeenCalledWith(
      'merchant-1',
      'gaming-laptops',
      'ogabassey.com',
      0,
      20,
      {
        graphics: ['8GB RTX 4070 Graphics', 'NVIDIA GeForce RTX 4070 8GB'],
      }
    );
    expect(page).toMatchObject({
      canonicalBaseUrl:
        'https://ogabassey.com/gaming-laptops/graphics/rtx-4070',
      countryName: 'Nigeria',
      productCount: 12,
    });
  });

  it('does not publish thin or unsupported hubs', async () => {
    mockGetData.mockResolvedValueOnce({
      productCount: 1,
      products: [{ id: 'product-1' }],
      productsQueryFailed: false,
    });

    await expect(
      loadGamingGraphicsHub({
        categorySlug: 'gaming-laptops',
        currentPage: 1,
        graphicsSlug: 'rtx-4070',
        merchantSlug: 'ogabassey.com',
      })
    ).resolves.toBeNull();
    await expect(
      loadGamingGraphicsHub({
        categorySlug: 'laptops',
        currentPage: 1,
        graphicsSlug: 'rtx-4070',
        merchantSlug: 'ogabassey.com',
      })
    ).resolves.toBeNull();
  });
});
