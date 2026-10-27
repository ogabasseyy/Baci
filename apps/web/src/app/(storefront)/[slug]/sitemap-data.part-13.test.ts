import { describe, expect, it } from 'vitest';
import {
  mockBuildCommercialSupportDiscoveryLinks,
  mockCategoriesQuery,
  mockGetCachedCategoryPageData,
  mockGetMerchantByIdentifier,
  registerSitemapDataTests,
  sitemapData,
} from './sitemap-data.test-setup';

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('caps commercial-support sitemap entries and stops before later batches', async () => {
    const { SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY } = sitemapData;
    mockCategoriesQuery(
      Array.from(
        { length: SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY + 1 },
        (_, index) => ({
          slug: `category-${index}`,
          updated_at: '2026-01-01T00:00:00Z',
        })
      )
    );
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [
        {
          id: 'iphone-17-pro-max',
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
      ],
    });
    const {
      getCommercialSupportSitemapEntries,
      resolveStorefrontSitemapContext,
      SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS,
    } = sitemapData;
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([]);
    mockBuildCommercialSupportDiscoveryLinks.mockImplementation(
      ({ categorySlug }: { categorySlug: string }) =>
        categorySlug === 'category-0'
          ? Array.from(
              { length: SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS + 5 },
              (_, index) => ({
                href: `https://ogabassey.com/category-0/compare/a-${index}-vs-b-${index}`,
                label: `A ${index} vs B ${index}`,
              })
            )
          : []
    );
    const context = await resolveStorefrontSitemapContext(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getCommercialSupportSitemapEntries(context);

    expect(entries).toHaveLength(SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS);
    expect(entries.at(-1)?.url).toBe(
      `https://ogabassey.com/category-0/compare/a-${SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS - 1}-vs-b-${SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS - 1}`
    );
    expect(mockGetCachedCategoryPageData).toHaveBeenCalledTimes(
      SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY
    );
    expect(mockBuildCommercialSupportDiscoveryLinks).toHaveBeenCalledTimes(
      SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY
    );
  });
});
