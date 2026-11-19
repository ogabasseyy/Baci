import { describe, expect, it } from 'vitest';
import {
  mockGetMerchantByIdentifier,
  mockHeaders,
  mockProductsQuery,
  registerSitemapDataTests,
  setCustomDomainHeader,
  sitemapData,
} from './sitemap-data.test-setup';

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('paginates product sitemap queries beyond the Supabase 1000 row default', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      is_published: true,
    });

    mockProductsQuery(
      Array.from({ length: 1002 }, (_, index) => ({
        id: `p${index + 1}`,
        name: `Product ${index + 1}`,
        slug: `product-${index + 1}`,
        category: 'Smartphones',
        images: [],
        updated_at: '2026-01-15T00:00:00Z',
        category_id: 'cat-1',
        category_slug: null,
        categories: { slug: 'smartphones' },
      }))
    );

    const { resolveStorefrontSitemapContext, getProductSitemapEntries } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );

    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getProductSitemapEntries(context);

    expect(entries).toHaveLength(1002);
    expect(entries[1001]?.url).toBe(
      'https://ogabassey.com/smartphones/product-1002'
    );
  });

  it('falls back to /products path when category slug is missing', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      is_published: true,
    });
    mockProductsQuery([
      {
        id: 'p2',
        name: 'MacBook Pro M4 Max',
        slug: 'macbook-pro-m4-max-36gb-1tb-16-inch',
        category: 'Laptops',
        images: [],
        updated_at: '2026-01-16T00:00:00Z',
        category_id: null,
        category_slug: null,
        categories: null,
      },
    ]);
    const { resolveStorefrontSitemapContext, getProductSitemapEntries } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );
    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const entries = await getProductSitemapEntries(context);

    expect(entries[0]).toMatchObject({
      url: 'https://ogabassey.com/products/macbook-pro-m4-max-36gb-1tb-16-inch',
    });
  });
});
