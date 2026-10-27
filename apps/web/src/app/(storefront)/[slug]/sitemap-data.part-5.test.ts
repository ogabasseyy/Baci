import { describe, expect, it } from 'vitest';
import {
  createEq,
  mockGetMerchantByIdentifier,
  mockHeaders,
  mockProductsQuery,
  mockSelectCalls,
  registerSitemapDataTests,
  setCustomDomainHeader,
  sitemapData,
} from './sitemap-data.test-setup';

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('does not select missing products.category_slug directly', async () => {
    mockProductsQuery([]);
    const { getProductSitemapEntries } = sitemapData;

    await getProductSitemapEntries({
      merchant: { id: 'merchant-1', slug: 'ogabassey', is_published: true },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: (table: string) => ({
          select: (columns: string) => {
            mockSelectCalls.push(columns);
            return { eq: createEq(table) };
          },
        }),
      },
    } as unknown as Parameters<typeof getProductSitemapEntries>[0]);

    expect(mockSelectCalls.join('\n')).not.toMatch(/\bcategory_slug\b/);
    expect(mockSelectCalls.join('\n')).toContain(
      'product_categories:product_categories(category_id, categories(slug, is_active))'
    );
  });

  it('includes blog child sitemaps in the sitemap index when the blog is enabled', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      feature_settings: { blog_enabled: true },
    });
    const { resolveStorefrontSitemapContext, getSitemapIndexLinks } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );
    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const links = await getSitemapIndexLinks(context);

    expect(links).toEqual([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
      'https://ogabassey.com/sitemap/categories.xml',
      'https://ogabassey.com/sitemap/brand-authority.xml',
      'https://ogabassey.com/sitemap/commercial-support.xml',
      'https://ogabassey.com/blog/sitemap.xml',
      'https://ogabassey.com/blog/news-sitemap.xml',
    ]);
  });

  it('includes the repairs child sitemap when the repairs catalogue is enabled', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      business_type: 'electronics',
      // blog_enabled comes straight off the snapshot's feature_settings now;
      // pinning it false keeps this case about the repairs link alone.
      feature_settings: { repairs_catalog_enabled: true, blog_enabled: false },
    });

    const { resolveStorefrontSitemapContext, getSitemapIndexLinks } =
      sitemapData;
    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers
    );
    if (!context) {
      throw new Error('Expected storefront sitemap context');
    }

    const links = await getSitemapIndexLinks(context);

    expect(links).toEqual([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
      'https://ogabassey.com/sitemap/categories.xml',
      'https://ogabassey.com/sitemap/brand-authority.xml',
      'https://ogabassey.com/sitemap/commercial-support.xml',
      'https://ogabassey.com/sitemap/repairs.xml',
    ]);
  });
});
