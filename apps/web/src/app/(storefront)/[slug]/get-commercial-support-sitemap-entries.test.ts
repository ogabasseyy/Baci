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

  it('suppresses price-band sitemap URLs when the band threshold is met only by managed zero-stock products without condition offers', async () => {
    const actual = await vi.importActual<
      typeof import('@/lib/storefront-compare/build-compare-discovery-links')
    >('@/lib/storefront-compare/build-compare-discovery-links');
    mockBuildCommercialSupportDiscoveryLinks.mockImplementation(
      actual.buildCommercialSupportDiscoveryLinks
    );

    mockCategoriesQuery([{ slug: 'gaming-laptops', updated_at: null }]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Gaming Laptops',
      products: [
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `asus-${i}`,
          slug: `asus-${i}`,
          name: `ASUS ROG ${i}`,
          brand: 'ASUS',
          price: 1_200_000,
          stock: 0,
          manage_stock: true,
          has_condition_offers: false,
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `msi-${i}`,
          slug: `msi-${i}`,
          name: `MSI Katana ${i}`,
          brand: 'MSI',
          price: 1_300_000,
          stock: 0,
          manage_stock: true,
          has_condition_offers: false,
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `lenovo-${i}`,
          slug: `lenovo-${i}`,
          name: `Lenovo Legion ${i}`,
          brand: 'Lenovo',
          price: 1_400_000,
          stock: 0,
          manage_stock: true,
          has_condition_offers: false,
        })),
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

    const priceBandUrls = entries.filter((e) => e.url.includes('/best-under/'));
    expect(priceBandUrls).toEqual([]);
  });

  it('coerces string-formatted product prices so legitimate price-band URLs are included in sitemaps', async () => {
    const actual = await vi.importActual<
      typeof import('@/lib/storefront-compare/build-compare-discovery-links')
    >('@/lib/storefront-compare/build-compare-discovery-links');
    mockBuildCommercialSupportDiscoveryLinks.mockImplementation(
      actual.buildCommercialSupportDiscoveryLinks
    );

    mockCategoriesQuery([{ slug: 'gaming-laptops', updated_at: null }]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Gaming Laptops',
      products: [
        ...Array.from({ length: 2 }, (_, i) => ({
          id: `asus-${i}`,
          slug: `asus-${i}`,
          name: `ASUS ROG ${i}`,
          brand: 'ASUS',
          price: '1,200,000',
          stock: 5,
          manage_stock: true,
          has_condition_offers: false,
        })),
        ...Array.from({ length: 2 }, (_, i) => ({
          id: `msi-${i}`,
          slug: `msi-${i}`,
          name: `MSI Katana ${i}`,
          brand: 'MSI',
          price: '1300000',
          stock: 5,
          manage_stock: true,
          has_condition_offers: false,
        })),
        ...Array.from({ length: 2 }, (_, i) => ({
          id: `lenovo-${i}`,
          slug: `lenovo-${i}`,
          name: `Lenovo Legion ${i}`,
          brand: 'Lenovo',
          price: '1,400,000',
          stock: 5,
          manage_stock: true,
          has_condition_offers: false,
        })),
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

    const priceBandUrls = entries.filter((e) => e.url.includes('/best-under/'));
    expect(priceBandUrls.length).toBeGreaterThan(0);
    expect(
      priceBandUrls.some((e) =>
        e.url.endsWith('/gaming-laptops/best-under/under-1-5m')
      )
    ).toBe(true);
  });
});
