import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCategory = vi.fn();
const mockInventory = vi.fn();
vi.mock('@/lib/storefront-category/brand-authority-public-data', () => ({
  brandAuthorityPublicData: {
    getCategory: (...args: unknown[]) => mockCategory(...args),
  },
}));
vi.mock(
  '@/lib/storefront-category/get-cached-brand-authority-inventory',
  () => ({
    getCachedBrandAuthorityInventory: (...args: unknown[]) =>
      mockInventory(...args),
  })
);

const { listEligibleAuthorityHubs } = await import(
  './list-eligible-authority-hubs'
);

function rawProduct(name: string, brand: string, index = 0) {
  return {
    id: `${brand.toLowerCase()}-${index}`,
    name,
    brand,
    price: 100_000,
    stock: 5,
    category_slug: 'smartphones',
  };
}

const SAMSUNG_SIX = [
  'Samsung Galaxy S24',
  'Samsung Galaxy S25',
  'Samsung Galaxy S26',
  'Samsung Galaxy A56',
  'Samsung Galaxy A36',
  'Samsung Galaxy Z Fold 7',
].map((name, index) => rawProduct(name, 'Samsung', index));

describe('listEligibleAuthorityHubs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockCategory.mockResolvedValue({ id: 'category-1', name: 'Smartphones' });
  });

  it('lists eligible brand hubs with their eligible model families', async () => {
    mockInventory.mockImplementation(
      async (
        _merchant: string,
        _category: string,
        entry: { brandKey: string }
      ) => ({
        latestUpdatedAt: '2026-10-30T00:00:00Z',
        products: entry.brandKey === 'samsung' ? SAMSUNG_SIX : [],
      })
    );

    await expect(listEligibleAuthorityHubs('merchant-1')).resolves.toEqual([
      {
        categorySlug: 'smartphones',
        brandKey: 'samsung',
        familyKeys: ['galaxy-s'],
        latestUpdatedAt: '2026-10-30T00:00:00Z',
      },
    ]);
  });

  it('skips a brand whose inventory lookup fails instead of failing the listing', async () => {
    mockInventory.mockImplementation(
      async (
        _merchant: string,
        _category: string,
        entry: { brandKey: string }
      ) => {
        if (entry.brandKey === 'apple') throw new Error('timeout');
        return {
          latestUpdatedAt: null,
          products: entry.brandKey === 'samsung' ? SAMSUNG_SIX : [],
        };
      }
    );

    const hubs = await listEligibleAuthorityHubs('merchant-1');

    expect(hubs.map((hub) => hub.brandKey)).toEqual(['samsung']);
    expect(hubs[0]?.latestUpdatedAt).toBeNull();
  });

  it('returns no hubs when the merchant lacks the category or its lookup fails', async () => {
    mockCategory.mockResolvedValueOnce(null);
    mockCategory.mockRejectedValue(new Error('db down'));
    mockInventory.mockResolvedValue({
      latestUpdatedAt: null,
      products: SAMSUNG_SIX,
    });

    await expect(listEligibleAuthorityHubs('merchant-1')).resolves.toEqual([]);
    expect(mockInventory).not.toHaveBeenCalled();
  });
});
