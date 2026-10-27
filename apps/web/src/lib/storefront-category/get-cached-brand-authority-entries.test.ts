import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCachedBrandAuthorityInventory = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));
vi.mock('./get-cached-brand-authority-inventory', () => ({
  getCachedBrandAuthorityInventory: (...args: unknown[]) =>
    mockGetCachedBrandAuthorityInventory(...args),
}));

describe('getCachedBrandAuthorityEntries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only curated brands that meet the inventory threshold', async () => {
    mockGetCachedBrandAuthorityInventory.mockImplementation(
      async (
        _merchantId: string,
        _categorySlug: string,
        entry: { displayName: string; brandQueryValue: string }
      ) => ({
        products: Array.from(
          {
            length:
              { 'Google Pixel': 6, Samsung: 5, Tecno: 4 }[entry.displayName] ??
              0,
          },
          (_, i) => ({
            id: `phone-${i}`,
            name: `Phone ${i}`,
            brand: entry.brandQueryValue,
            price: 100000,
            manage_stock: false,
          })
        ),
        productCount:
          { 'Google Pixel': 6, Samsung: 5, Tecno: 4 }[entry.displayName] ?? 0,
      })
    );
    const { getCachedBrandAuthorityEntries } = await import(
      './get-cached-brand-authority-entries'
    );

    const entries = await getCachedBrandAuthorityEntries(
      'merchant-1',
      'smartphones'
    );

    expect(
      entries.map((entry) => [entry.brandKey, entry.productCount])
    ).toEqual([
      ['samsung', 5],
      ['google', 6],
    ]);
    expect(mockGetCachedBrandAuthorityInventory).toHaveBeenCalledTimes(9);
  });

  it('fails optional category links open when the query fails', async () => {
    mockGetCachedBrandAuthorityInventory.mockRejectedValue(
      new Error('timeout')
    );
    const { getCachedBrandAuthorityEntries } = await import(
      './get-cached-brand-authority-entries'
    );

    await expect(
      getCachedBrandAuthorityEntries('merchant-1', 'smartphones')
    ).resolves.toEqual([]);
  });

  it('skips database work for categories without curated brand hubs', async () => {
    const { getCachedBrandAuthorityEntries } = await import(
      './get-cached-brand-authority-entries'
    );

    await expect(
      getCachedBrandAuthorityEntries('merchant-1', 'tablets')
    ).resolves.toEqual([]);
    expect(mockGetCachedBrandAuthorityInventory).not.toHaveBeenCalled();
  });
  it('does not advertise category brand cards using stale counts without renderable products', async () => {
    mockGetCachedBrandAuthorityInventory.mockResolvedValue({
      productCount: 100,
      products: [],
      productCountIsLowerBound: false,
    });
    const { getCachedBrandAuthorityEntries } = await import(
      './get-cached-brand-authority-entries'
    );
    await expect(
      getCachedBrandAuthorityEntries('merchant-1', 'smartphones')
    ).resolves.toEqual([]);
  });
});
