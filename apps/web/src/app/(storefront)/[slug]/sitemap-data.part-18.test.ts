import { describe, expect, it } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';
import {
  createEq,
  mockBuildCommercialSupportDiscoveryLinks,
  mockCategoriesQuery,
  mockGetCachedCategoryPageData,
  mockGetMerchantByIdentifier,
  mockHeaders,
  registerSitemapDataTests,
  sitemapData,
} from './sitemap-data.test-setup';

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('omits lastmod from commercial-support entries when the category has no timestamp', async () => {
    mockCategoriesQuery([{ slug: 'smartphones', updated_at: null }]);
    mockGetCachedCategoryPageData.mockResolvedValue({
      isCollection: false,
      fallbackName: 'Smartphones',
      products: [],
    });
    mockBuildCommercialSupportDiscoveryLinks.mockReturnValue([
      {
        href: 'https://ogabassey.com/smartphones/compare/a-vs-b',
        label: 'A vs B',
      },
      {
        href: 'https://ogabassey.com/smartphones/compare/a-vs-c',
        label: 'A vs C',
      },
    ]);
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
        url: 'https://ogabassey.com/smartphones/compare/a-vs-b',
      }),
      expect.objectContaining({
        url: 'https://ogabassey.com/smartphones/compare/a-vs-c',
      }),
    ]);
    expect(entries[0]?.lastModified).toBeUndefined();
  });

  it('creates sitemap unavailable response with 503, no-store, and retry-after', () => {
    const { createSitemapUnavailableResponse } = sitemapData;
    const response = createSitemapUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('300');
  });

  it('creates sitemap not-found response with 404 and no retry header', () => {
    const { createSitemapNotFoundResponse } = sitemapData;
    const response = createSitemapNotFoundResponse();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBeNull();
  });

  it('marks transient storefront sitemap lookup failures as unavailable', async () => {
    mockGetMerchantByIdentifier.mockRejectedValueOnce(
      new Error('Database timeout')
    );
    const { resolveStorefrontSitemapContextResult } = sitemapData;

    const result = await resolveStorefrontSitemapContextResult(
      mockHeaders as unknown as Headers,
      'test-store',
      new Request('https://test-store.usebaci.com/sitemap/static.xml')
    );

    expect(result.status).toBe('unavailable');
  });

  it('distinguishes missing storefront sitemaps from transient lookup failures', async () => {
    mockGetMerchantByIdentifier.mockResolvedValueOnce(null);
    const { resolveStorefrontSitemapContextResult } = sitemapData;

    const result = await resolveStorefrontSitemapContextResult(
      mockHeaders as unknown as Headers,
      'test-store',
      new Request('https://test-store.usebaci.com/sitemap/static.xml')
    );

    expect(result.status).toBe('not-found');
  });
});
