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

describe('getCommercialSupportSitemapEntries - stock and price parsing', () => {
  registerSitemapDataTests();

  beforeAll(async () => {
    const mod = await import('./get-commercial-support-sitemap-entries');
    getCommercialSupportSitemapEntries = mod.getCommercialSupportSitemapEntries;
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

  it('omits has_condition_offers key when undefined/null on source rows to maintain availability parity with destination loader', async () => {
    let capturedProducts: unknown[] = [];
    mockBuildCommercialSupportDiscoveryLinks.mockImplementation(
      (args: { products: unknown[] }) => {
        capturedProducts = args.products;
        return [];
      }
    );

    mockCategoriesQuery([{ slug: 'smartphones', updated_at: null }]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [
        {
          id: 'p-legacy',
          slug: 'p-legacy',
          name: 'Legacy Phone',
          brand: 'BrandX',
          price: 150_000,
          stock: 1,
          manage_stock: false,
          // has_condition_offers omitted
        },
        {
          id: 'p-with-offers',
          slug: 'p-with-offers',
          name: 'Phone With Offers',
          brand: 'BrandY',
          price: 200_000,
          stock: 0,
          manage_stock: true,
          has_condition_offers: true,
        },
      ],
    });

    await getCommercialSupportSitemapEntries({
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

    expect(capturedProducts[0]).not.toHaveProperty('has_condition_offers');
    expect(capturedProducts[1]).toHaveProperty('has_condition_offers', true);
  });

  it('omits price-band URLs for inactive categories', async () => {
    mockCategoriesQuery([{ slug: 'smartphones', updated_at: null }]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      isInactiveCategory: true,
      fallbackName: 'Smartphones',
      products: [
        {
          id: 'p-1',
          slug: 'p-1',
          name: 'Phone 1',
          brand: 'BrandX',
          price: 150_000,
          stock: 5,
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

    const priceBandUrls = entries.filter((e) => e.url.includes('/best-under/'));
    expect(priceBandUrls).toEqual([]);
  });

  it('fails closed to empty sitemap entries when category query failure flags are set', async () => {
    mockCategoriesQuery([{ slug: 'smartphones', updated_at: null }]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      isInactiveCategory: false,
      productsQueryFailed: true,
      fallbackName: 'Smartphones',
      products: [
        {
          id: 'p-1',
          slug: 'p-1',
          name: 'Phone 1',
          brand: 'BrandX',
          price: 150_000,
          stock: 5,
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

    expect(entries).toEqual([]);
  });
});
