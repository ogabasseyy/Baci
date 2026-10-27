import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedCategoryPageData } from '@/lib/cached-data';
import { loadPriceBandDestinationPoolSafely } from './load-price-band-destination-pool-safely';

vi.mock('@/lib/cached-data', () => ({
  getCachedCategoryPageData: vi.fn(),
}));

const mockGetCategoryPageData = vi.mocked(getCachedCategoryPageData);

describe('loadPriceBandDestinationPoolSafely', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps destination category products to band pool rows', async () => {
    mockGetCategoryPageData.mockResolvedValue({
      isCollection: false,
      category: { slug: 'smartphones' },
      products: [
        {
          id: 'p1',
          name: 'iPhone 17',
          brand: 'Apple',
          price: 500_000,
          stock: 3,
          category_slug: 'smartphones',
        },
      ],
    } as never);
    const pool = await loadPriceBandDestinationPoolSafely({
      merchantId: 'm1',
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
    });
    expect(pool).toHaveLength(1);
    expect(pool?.[0]).toMatchObject({
      name: 'iPhone 17',
      brand: 'Apple',
      price: 500_000,
    });
  });

  it('returns null for collections and load failures', async () => {
    mockGetCategoryPageData.mockResolvedValue({
      isCollection: true,
      products: [],
    } as never);
    await expect(
      loadPriceBandDestinationPoolSafely({
        merchantId: 'm1',
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
      })
    ).resolves.toBeNull();

    mockGetCategoryPageData.mockRejectedValue(new Error('down'));
    await expect(
      loadPriceBandDestinationPoolSafely({
        merchantId: 'm1',
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
      })
    ).resolves.toBeNull();
  });
});
