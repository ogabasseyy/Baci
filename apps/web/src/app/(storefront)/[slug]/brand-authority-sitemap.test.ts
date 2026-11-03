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

function rawProduct(name: string, brand: string, index = 0) {
  return {
    id: `${brand.toLowerCase()}-${index}-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    brand,
    price: 100_000,
    stock: 5,
    category_slug: 'smartphones',
  };
}

describe('getBrandAuthoritySitemapEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategory.mockResolvedValue({ id: 'category-1', name: 'Smartphones' });
  });

  it('does not query brand authority inventory for an unpublished store', async () => {
    const { getBrandAuthoritySitemapEntries } = await import(
      './brand-authority-sitemap'
    );

    await expect(
      getBrandAuthoritySitemapEntries({
        merchant: { id: 'merchant-1', slug: 'store', is_published: false },
        storeUrl: 'https://store.test',
      } as never)
    ).resolves.toEqual([]);

    expect(mockCategory).not.toHaveBeenCalled();
    expect(mockInventory).not.toHaveBeenCalled();
  });

  it('emits eligible brand hubs and isolates inventory failures', async () => {
    mockInventory.mockImplementation(
      async (
        _merchant: string,
        _category: string,
        entry: { brandKey: string }
      ) => {
        if (entry.brandKey === 'google') throw new Error('timeout');
        return {
          productCount: entry.brandKey === 'samsung' ? 5 : 0,
          latestUpdatedAt: '2026-07-21T00:00:00Z',
          products:
            entry.brandKey === 'samsung'
              ? [
                  'Samsung Galaxy S24',
                  'Samsung Galaxy S25',
                  'Samsung Galaxy A56',
                  'Samsung Galaxy A36',
                  'Samsung Galaxy Z Fold 7',
                ].map((name, index) => rawProduct(name, 'Samsung', index))
              : [],
        };
      }
    );
    const { getBrandAuthoritySitemapEntries } = await import(
      './brand-authority-sitemap'
    );
    const entries = await getBrandAuthoritySitemapEntries({
      merchant: { id: 'merchant-1', slug: 'store', is_published: true },
      storeUrl: 'https://store.test',
    } as never);
    expect(entries.map((entry) => entry.url)).toEqual([
      'https://store.test/smartphones/brands/samsung',
    ]);
  });

  it('emits family hubs only when the family has enough products', async () => {
    mockInventory.mockImplementation(
      async (
        _merchant: string,
        _category: string,
        entry: { brandKey: string }
      ) => ({
        productCount: entry.brandKey === 'samsung' ? 6 : 0,
        latestUpdatedAt: '2026-07-21T00:00:00Z',
        products:
          entry.brandKey === 'samsung'
            ? [
                'Samsung Galaxy S24',
                'Samsung Galaxy S25',
                'Samsung Galaxy S26',
                'Samsung Galaxy A56',
                'Samsung Galaxy A36',
                'Samsung Galaxy Z Fold 7',
              ].map((name, index) => rawProduct(name, 'Samsung', index))
            : [],
      })
    );
    const { getBrandAuthoritySitemapEntries } = await import(
      './brand-authority-sitemap'
    );
    const entries = await getBrandAuthoritySitemapEntries({
      merchant: { id: 'merchant-1', slug: 'store', is_published: true },
      storeUrl: 'https://store.test',
    } as never);
    expect(entries.map((entry) => entry.url)).toEqual([
      'https://store.test/smartphones/brands/samsung',
      'https://store.test/smartphones/brands/samsung/families/galaxy-s',
    ]);
  });

  it('includes the Infinix HOT hub with two active matching models', async () => {
    mockInventory.mockImplementation(
      async (
        _merchant: string,
        _category: string,
        entry: { brandKey: string }
      ) => ({
        productCount: entry.brandKey === 'infinix' ? 5 : 0,
        latestUpdatedAt: '2026-09-23T00:00:00Z',
        products:
          entry.brandKey === 'infinix'
            ? [
                'Infinix Hot 70',
                'Infinix Hot 70 Pro',
                'Infinix Note 60',
                'Infinix Note 60 Pro',
                'Infinix Note 60 Pro Plus',
              ].map((name, index) => rawProduct(name, 'Infinix', index))
            : [],
      })
    );
    const { getBrandAuthoritySitemapEntries } = await import(
      './brand-authority-sitemap'
    );
    const entries = await getBrandAuthoritySitemapEntries({
      merchant: { id: 'merchant-1', slug: 'store', is_published: true },
      storeUrl: 'https://store.test',
    } as never);

    expect(entries.map((entry) => entry.url)).toContain(
      'https://store.test/smartphones/brands/infinix/families/hot'
    );
  });

  it('keeps the brand hub when no model family meets its threshold', async () => {
    mockInventory.mockImplementation(
      async (
        _merchant: string,
        _category: string,
        entry: { brandKey: string }
      ) => ({
        productCount: entry.brandKey === 'samsung' ? 5 : 0,
        latestUpdatedAt: '2026-07-21T00:00:00Z',
        products:
          entry.brandKey === 'samsung'
            ? [
                'Samsung Galaxy S25',
                'Samsung Galaxy S26',
                'Samsung Galaxy A56',
                'Samsung Galaxy Z Fold 7',
                'Samsung Galaxy Z Flip 7',
              ].map((name, index) => rawProduct(name, 'Samsung', index))
            : [],
      })
    );
    const { getBrandAuthoritySitemapEntries } = await import(
      './brand-authority-sitemap'
    );
    const entries = await getBrandAuthoritySitemapEntries({
      merchant: { id: 'merchant-1', slug: 'store', is_published: true },
      storeUrl: 'https://store.test',
    } as never);

    expect(entries.map((entry) => entry.url)).toEqual([
      'https://store.test/smartphones/brands/samsung',
    ]);
  });

  it('includes a model family appearing after index 48 of brand inventory in the sitemap', async () => {
    mockInventory.mockImplementation(
      async (
        _merchant: string,
        _category: string,
        entry: { brandKey: string }
      ) => ({
        productCount: entry.brandKey === 'samsung' ? 51 : 0,
        latestUpdatedAt: '2026-07-21T00:00:00Z',
        products:
          entry.brandKey === 'samsung'
            ? [
                ...Array.from({ length: 48 }, (_, index) =>
                  rawProduct(`Samsung Other ${index}`, 'Samsung', index)
                ),
                rawProduct('Galaxy S24', 'Samsung', 48),
                rawProduct('Galaxy S25', 'Samsung', 49),
                rawProduct('Galaxy S26', 'Samsung', 50),
              ]
            : [],
      })
    );
    const { getBrandAuthoritySitemapEntries } = await import(
      './brand-authority-sitemap'
    );
    const entries = await getBrandAuthoritySitemapEntries({
      merchant: { id: 'merchant-1', slug: 'store', is_published: true },
      storeUrl: 'https://store.test',
    } as never);

    expect(entries.map((entry) => entry.url)).toEqual([
      'https://store.test/smartphones/brands/samsung',
      'https://store.test/smartphones/brands/samsung/families/galaxy-s',
    ]);
  });
});
