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

  it('keeps child-category products out of parent-category compare sitemap URLs', async () => {
    mockCategoriesQuery([
      { slug: 'electronics', updated_at: '2026-01-01T00:00:00Z' },
    ]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Electronics',
      products: [
        {
          id: 'iphone-17-pro-max',
          slug: 'iphone-17-pro-max',
          name: 'iPhone 17 Pro Max',
          brand: 'Apple',
          price: 495000,
          categories: { slug: 'smartphones', name: 'Smartphones' },
          product_key_specs: {
            chipset: 'A19 Pro',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
      ],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockImplementation(
      ({
        products,
      }: {
        products: Array<{ category_slug: string; slug: string }>;
      }) =>
        products.map((product) => ({
          href: `https://ogabassey.com/${product.category_slug}/compare/${product.slug}-vs-anchor`,
          label: `${product.slug} vs Anchor`,
        }))
    );
    const {
      getCommercialSupportSitemapEntries,
      resolveStorefrontSitemapContext,
    } = sitemapData;
    mockGetMerchantByIdentifier.mockResolvedValueOnce({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    const context = await resolveStorefrontSitemapContext(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getCommercialSupportSitemapEntries(context);

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-anchor',
        }),
      ])
    );
    expect(entries.map((entry) => entry.url)).not.toContain(
      'https://ogabassey.com/electronics/compare/iphone-17-pro-max-vs-anchor'
    );
  });
});
