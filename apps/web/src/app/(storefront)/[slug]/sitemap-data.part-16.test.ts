import { describe, expect, it } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';
import {
  createEq,
  mockCategoriesQuery,
  mockGetCachedCategoryProductCounts,
  registerSitemapDataTests,
  sitemapData,
} from './sitemap-data.test-setup';

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('serializes a sitemap index with sitemap loc entries', () => {
    const { serializeSitemapIndex } = sitemapData;
    const xml = serializeSitemapIndex([
      'https://ogabassey.com/sitemap/static.xml',
      'https://ogabassey.com/sitemap/products.xml',
    ]);

    expect(xml).toContain(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );
    expect(xml).toContain(
      '<sitemap><loc>https://ogabassey.com/sitemap/static.xml</loc></sitemap>'
    );
    expect(xml).toContain(
      '<sitemap><loc>https://ogabassey.com/sitemap/products.xml</loc></sitemap>'
    );
    expect(xml).not.toContain('<urlset');
  });

  it('creates a cacheable XML response for the sitemap index', async () => {
    const { createSitemapIndexResponse } = sitemapData;
    const response = createSitemapIndexResponse([
      'https://ogabassey.com/sitemap/static.xml',
    ]);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400'
    );
    expect(body).toContain('<sitemapindex');
  });

  it('omits lastmod from category entries when updated_at is missing', async () => {
    mockCategoriesQuery([
      {
        id: 'category-smartphones',
        slug: 'smartphones',
        updated_at: null,
        is_active: true,
        parent_id: null,
      },
    ]);
    mockGetCachedCategoryProductCounts.mockResolvedValueOnce({
      'category-smartphones': 1,
    });
    const { getCategorySitemapEntries } = sitemapData;

    const entries = await getCategorySitemapEntries({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
      },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: (table: string) => ({
          select: () => ({ eq: createEq(table) }),
        }),
      },
    } as unknown as StorefrontSitemapContext);

    expect(entries).toEqual([
      expect.objectContaining({ url: 'https://ogabassey.com/smartphones' }),
    ]);
    expect(entries[0]?.lastModified).toBeUndefined();
  });
});
