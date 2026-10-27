import { describe, expect, it } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';
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

  it('adds publishable trust policy URLs to the static sitemap entries', async () => {
    const { getNamedSitemapEntries } = sitemapData;
    const context = {
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
        updated_at: '2026-06-01T00:00:00Z',
        trust_profile: {
          return_policy: { summary: 'Returns accepted within 7 days.' },
          shipping_policy: { summary: 'Ships nationwide.' },
          warranty_policy: { summary: 'One-year warranty included.' },
        },
      },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({ data: [], error: null }),
          }),
        }),
      },
    } as unknown as StorefrontSitemapContext;

    const staticEntries = await getNamedSitemapEntries(context, 'static');

    expect(staticEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://ogabassey.com/returns',
          lastModified: new Date('2026-06-01T00:00:00Z'),
        }),
        expect.objectContaining({ url: 'https://ogabassey.com/shipping' }),
        expect.objectContaining({ url: 'https://ogabassey.com/warranty' }),
      ])
    );
  });

  it('returns product sitemap entries with category paths and images', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      is_published: true,
    });
    mockProductsQuery([
      {
        id: 'p1',
        name: 'iPhone 15',
        slug: 'iphone-15',
        category: 'Smartphones',
        images: ['https://img.example.com/iphone.jpg'],
        updated_at: '2026-01-15T00:00:00Z',
        category_id: 'cat-1',
        category_slug: null,
        categories: { slug: 'smartphones' },
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
      url: 'https://ogabassey.com/smartphones/iphone-15',
      images: ['https://img.example.com/iphone.jpg'],
    });
  });
});
