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

  it('deduplicates commercial-support URLs across category batches', async () => {
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
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([
      {
        href: 'https://ogabassey.com/smartphones/compare/a-vs-b',
        label: 'A vs B',
      },
    ]);
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

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/compare/a-vs-b',
      }),
    ]);
  });

  it('resolves slug from request host when headersList is empty and override is undefined', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'hhjjk',
    });
    const { resolveStorefrontSitemapContext } = sitemapData;
    const emptyHeaders = new Headers();
    const req = new Request('https://hhjjk.usebaci.com/sitemap.xml');

    const context = await resolveStorefrontSitemapContext(
      emptyHeaders,
      undefined,
      req
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('hhjjk');
    expect(context?.merchant.slug).toBe('hhjjk');
  });
});
