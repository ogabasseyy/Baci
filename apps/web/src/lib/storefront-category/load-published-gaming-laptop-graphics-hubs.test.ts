import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCachedCategoryPageData = vi.fn();
const mockGetCachedCategoryPageGraphicsOptions = vi.fn();

vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageData: (...args: unknown[]) =>
    mockGetCachedCategoryPageData(...args),
  getCachedCategoryPageGraphicsOptions: (...args: unknown[]) =>
    mockGetCachedCategoryPageGraphicsOptions(...args),
}));

const { loadPublishedGamingLaptopGraphicsHubs } = await import(
  './load-published-gaming-laptop-graphics-hubs'
);

describe('loadPublishedGamingLaptopGraphicsHubs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedCategoryPageGraphicsOptions.mockResolvedValue([
      'NVIDIA GeForce RTX 4060 8GB',
      'NVIDIA GeForce RTX 4070 8GB',
    ]);
    mockGetCachedCategoryPageData.mockImplementation(
      async (...args: unknown[]) => {
        const filters = args[5] as { graphics: string[] };
        const productCount = filters.graphics[0]?.includes('4060') ? 2 : 1;
        return {
          productCount,
          products: [{}],
          productIdsQueryFailed: false,
          productsQueryFailed: false,
        };
      }
    );
  });

  it('publishes only hubs backed by at least two matching products', async () => {
    await expect(
      loadPublishedGamingLaptopGraphicsHubs({
        categorySlug: 'gaming-laptops',
        merchantId: 'merchant-1',
        storeSlug: 'ogabassey',
      })
    ).resolves.toEqual([
      expect.objectContaining({ label: 'RTX 4060', slug: 'rtx-4060' }),
    ]);
  });

  it('fails closed when a candidate inventory read is incomplete', async () => {
    mockGetCachedCategoryPageData.mockResolvedValue({
      productCount: 4,
      products: [{}],
      productIdsQueryFailed: true,
      productsQueryFailed: false,
    });

    await expect(
      loadPublishedGamingLaptopGraphicsHubs({
        categorySlug: 'gaming-laptops',
        merchantId: 'merchant-1',
        storeSlug: 'ogabassey',
      })
    ).resolves.toEqual([]);
  });
});
