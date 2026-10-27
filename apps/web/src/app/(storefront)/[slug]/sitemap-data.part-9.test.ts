import { describe, expect, it } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';
import {
  createEq,
  mockBuildCommercialSupportDiscoveryLinks,
  mockCategoriesQuery,
  mockGetCachedCategoryPageData,
  registerSitemapDataTests,
  sitemapData,
} from './sitemap-data.test-setup';

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('passes the active related category to commercial support discovery links', async () => {
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
          category_slug: 'phones',
          product_categories: [
            { categories: { slug: 'smartphones', name: 'Smartphones' } },
          ],
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
    const { getCommercialSupportSitemapEntries } = sitemapData;

    const entries = await getCommercialSupportSitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: (table: string) => ({
          select: () => ({ eq: createEq(table) }),
        }),
      },
    } as unknown as StorefrontSitemapContext);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-anchor',
      }),
    ]);
  });
});
