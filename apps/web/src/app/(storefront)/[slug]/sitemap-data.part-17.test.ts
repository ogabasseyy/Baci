import { describe, expect, it } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';
import {
  mockGetBrandAuthorityCategory,
  mockGetCachedBrandAuthorityInventory,
  registerSitemapDataTests,
  sitemapData,
} from './sitemap-data.test-setup';

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('lists only inventory-qualified curated brand authority hubs', async () => {
    mockGetBrandAuthorityCategory.mockResolvedValue({
      id: 'category-1',
      name: 'Smartphones',
    });
    mockGetCachedBrandAuthorityInventory.mockImplementation(
      async (
        _merchantId: string,
        _categorySlug: string,
        entry: { brandKey: string; brandQueryValue: string }
      ) => ({
        products: Array.from(
          { length: { google: 5, samsung: 5, tecno: 4 }[entry.brandKey] ?? 0 },
          (_, i) => ({
            id: `phone-${i}`,
            name: `Phone ${i}`,
            brand: entry.brandQueryValue,
            price: 100000,
            manage_stock: false,
          })
        ),
        latestUpdatedAt:
          entry.brandKey === 'samsung' ? '2026-07-14T00:00:00Z' : null,
        productCount: { google: 5, samsung: 5, tecno: 4 }[entry.brandKey] ?? 0,
      })
    );
    const { getBrandAuthoritySitemapEntries } = sitemapData;

    const entries = await getBrandAuthoritySitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {},
    } as unknown as StorefrontSitemapContext);

    expect(entries.map((entry) => entry.url)).toEqual([
      'https://ogabassey.com/smartphones/brands/samsung',
      'https://ogabassey.com/smartphones/brands/google',
    ]);
    expect(entries[0]?.lastModified).toEqual(new Date('2026-07-14T00:00:00Z'));
    expect(entries[1]?.lastModified).toBeUndefined();
    // Pin the curated authority set explicitly (9 smartphone brands +
    // laptops Apple) so taxonomy edits cannot silently expand sitemap fan-out.
    expect(mockGetCachedBrandAuthorityInventory).toHaveBeenCalledTimes(10);
  });

  it('keeps successful authority hubs when a single brand query fails', async () => {
    mockGetBrandAuthorityCategory.mockResolvedValue({
      id: 'category-1',
      name: 'Smartphones',
    });
    mockGetCachedBrandAuthorityInventory.mockImplementation(
      async (
        _merchantId: string,
        _categorySlug: string,
        entry: { brandKey: string; brandQueryValue: string }
      ) => {
        if (entry.brandKey !== 'samsung') throw new Error('timeout');
        return {
          latestUpdatedAt: '2026-07-14T00:00:00Z',
          productCount: 5,
          products: Array.from({ length: 5 }, (_, i) => ({
            id: `phone-${i}`,
            name: `Phone ${i}`,
            brand: entry.brandQueryValue,
            price: 100000,
            manage_stock: false,
          })),
        };
      }
    );
    const { getBrandAuthoritySitemapEntries } = sitemapData;

    const entries = await getBrandAuthoritySitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {},
    } as unknown as StorefrontSitemapContext);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/brands/samsung',
      }),
    ]);
  });

  it('omits authority hubs when the category cannot render publicly', async () => {
    mockGetBrandAuthorityCategory.mockResolvedValue(null);
    const { getBrandAuthoritySitemapEntries } = sitemapData;

    await expect(
      getBrandAuthoritySitemapEntries({
        merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
        storeUrl: 'https://ogabassey.com',
        supabase: {},
      } as unknown as StorefrontSitemapContext)
    ).resolves.toEqual([]);
    expect(mockGetCachedBrandAuthorityInventory).not.toHaveBeenCalled();
  });
});
