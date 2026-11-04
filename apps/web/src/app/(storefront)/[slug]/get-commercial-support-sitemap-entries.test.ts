import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';
import {
  createEq,
  mockBuildCommercialSupportDiscoveryLinks,
  mockCategoriesQuery,
  mockGetCachedCategoryPageData,
  registerSitemapDataTests,
} from './sitemap-data.test-setup';

let getCommercialSupportSitemapEntries: typeof import('./get-commercial-support-sitemap-entries').getCommercialSupportSitemapEntries;

describe('getCommercialSupportSitemapEntries', () => {
  registerSitemapDataTests();

  beforeAll(async () => {
    const mod = await import('./get-commercial-support-sitemap-entries');
    getCommercialSupportSitemapEntries = mod.getCommercialSupportSitemapEntries;
  });

  it('threads merchantCurrency into buildCommercialSupportDiscoveryLinks', async () => {
    mockCategoriesQuery([{ slug: 'gaming-laptops', updated_at: null }]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Gaming Laptops',
      products: [],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([
      {
        href: 'https://ogabassey.com/gaming-laptops/best-under/under-1-5m',
        label: 'Best Under ₦1,500,000',
      },
    ]);

    const entries = await getCommercialSupportSitemapEntries({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        payout_currency: 'NGN',
      },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: (table: string) => ({
          select: () => ({ eq: createEq(table) }),
        }),
      },
    } as unknown as StorefrontSitemapContext);

    expect(mockBuildCommercialSupportDiscoveryLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlug: 'gaming-laptops',
        merchantCurrency: 'NGN',
      })
    );
    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/gaming-laptops/best-under/under-1-5m',
      }),
    ]);
  });

  it('emits all eligible price-band URLs for a multi-band category in sitemap entries', async () => {
    const actual = await vi.importActual<
      typeof import('@/lib/storefront-compare/build-compare-discovery-links')
    >('@/lib/storefront-compare/build-compare-discovery-links');
    mockBuildCommercialSupportDiscoveryLinks.mockImplementation(
      actual.buildCommercialSupportDiscoveryLinks
    );

    mockCategoriesQuery([{ slug: 'smartphones', updated_at: null }]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [
        // 6 products under 500k across 3 brands (Apple, Samsung, Tecno)
        {
          id: 'a1',
          slug: 'a1',
          name: 'A1',
          brand: 'Apple',
          price: 300_000,
          stock: 5,
          manage_stock: true,
        },
        {
          id: 'a2',
          slug: 'a2',
          name: 'A2',
          brand: 'Apple',
          price: 350_000,
          stock: 5,
          manage_stock: true,
        },
        {
          id: 's1',
          slug: 's1',
          name: 'S1',
          brand: 'Samsung',
          price: 400_000,
          stock: 5,
          manage_stock: true,
        },
        {
          id: 's2',
          slug: 's2',
          name: 'S2',
          brand: 'Samsung',
          price: 420_000,
          stock: 5,
          manage_stock: true,
        },
        {
          id: 't1',
          slug: 't1',
          name: 'T1',
          brand: 'Tecno',
          price: 250_000,
          stock: 5,
          manage_stock: true,
        },
        {
          id: 't2',
          slug: 't2',
          name: 'T2',
          brand: 'Tecno',
          price: 280_000,
          stock: 5,
          manage_stock: true,
        },
        // 6 products under 1m across 3 brands (Apple, Samsung, Tecno)
        {
          id: 'a3',
          slug: 'a3',
          name: 'A3',
          brand: 'Apple',
          price: 600_000,
          stock: 5,
          manage_stock: true,
        },
        {
          id: 'a4',
          slug: 'a4',
          name: 'A4',
          brand: 'Apple',
          price: 700_000,
          stock: 5,
          manage_stock: true,
        },
        {
          id: 's3',
          slug: 's3',
          name: 'S3',
          brand: 'Samsung',
          price: 650_000,
          stock: 5,
          manage_stock: true,
        },
        {
          id: 's4',
          slug: 's4',
          name: 'S4',
          brand: 'Samsung',
          price: 750_000,
          stock: 5,
          manage_stock: true,
        },
        {
          id: 't3',
          slug: 't3',
          name: 'T3',
          brand: 'Tecno',
          price: 620_000,
          stock: 5,
          manage_stock: true,
        },
        {
          id: 't4',
          slug: 't4',
          name: 'T4',
          brand: 'Tecno',
          price: 680_000,
          stock: 5,
          manage_stock: true,
        },
      ],
    });

    const entries = await getCommercialSupportSitemapEntries({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        payout_currency: 'NGN',
      },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: (table: string) => ({
          select: () => ({ eq: createEq(table) }),
        }),
      },
    } as unknown as StorefrontSitemapContext);

    const priceBandUrls = entries
      .filter((e) => e.url.includes('/best-under/'))
      .map((e) => e.url);

    expect(priceBandUrls).toContain(
      'https://ogabassey.com/smartphones/best-under/under-500k'
    );
    expect(priceBandUrls).toContain(
      'https://ogabassey.com/smartphones/best-under/under-1m'
    );
    expect(priceBandUrls).toHaveLength(2);
  });
});
