import { describe, expect, it } from 'vitest';
import {
  mockBuildCommercialSupportDiscoveryLinks,
  mockCategoriesQuery,
  mockGetCachedCategoryPageData,
  mockGetMerchantByIdentifier,
  mockHeaders,
  registerSitemapDataTests,
  setCustomDomainHeader,
  sitemapData,
} from './sitemap-data.test-setup';

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('publishes eligible compare pages through the public sitemap surfaces', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    });
    mockCategoriesQuery([
      { slug: 'smartphones', updated_at: '2026-01-01T00:00:00Z' },
    ]);
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
        {
          id: 'samsung-galaxy-z-trifold',
          slug: 'samsung-galaxy-z-trifold',
          name: 'Samsung Galaxy Z TriFold',
          brand: 'Samsung',
          price: 480000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Snapdragon 8 Elite',
            ram_gb: 16,
            storage_gb: 512,
          },
        },
      ],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([
      {
        href: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        label: 'iPhone 17 Pro Max vs Samsung Galaxy Z TriFold',
      },
    ]);
    const { resolveStorefrontSitemapContext, getNamedSitemapEntries } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const namedEntries = await getNamedSitemapEntries(
      context,
      'commercial-support'
    );

    expect(
      namedEntries.some((entry) =>
        entry.url.includes(
          '/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold'
        )
      )
    ).toBe(true);
  });
});
