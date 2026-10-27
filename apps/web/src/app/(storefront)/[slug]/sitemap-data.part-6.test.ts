import { describe, expect, it, vi } from 'vitest';
import type { StorefrontSitemapContext } from './sitemap-data';
import {
  mockGetMerchantByIdentifier,
  mockHeaders,
  registerSitemapDataTests,
  setCustomDomainHeader,
  sitemapData,
} from './sitemap-data.test-setup';

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('omits the repairs child sitemap when the repairs catalogue is disabled', async () => {
    setCustomDomainHeader('ogabassey.com');
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
      business_type: 'electronics',
      feature_settings: { repairs_catalog_enabled: false, blog_enabled: false },
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

    expect(links).not.toContain('https://ogabassey.com/sitemap/repairs.xml');
  });

  it('builds repairs sitemap entries for the index and active device pages', async () => {
    const { getRepairsSitemapEntries } = sitemapData;

    const entries = await getRepairsSitemapEntries({
      merchant: {
        id: 'merchant-1',
        is_published: true,
        slug: 'ogabassey',
        business_type: 'electronics',
        feature_settings: { repairs_catalog_enabled: true },
      },
      storeUrl: 'https://ogabassey.com',
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  data: [
                    { slug: 'apple-iphone-13' },
                    { slug: 'samsung-galaxy-s23' },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      },
    } as unknown as StorefrontSitemapContext);

    expect(entries).toEqual([
      expect.objectContaining({ url: 'https://ogabassey.com/repairs' }),
      expect.objectContaining({
        url: 'https://ogabassey.com/repairs/apple-iphone-13',
      }),
      expect.objectContaining({
        url: 'https://ogabassey.com/repairs/samsung-galaxy-s23',
      }),
    ]);
    expect(entries[0]?.lastModified).toBeUndefined();
  });

  it('returns no direct repairs sitemap entries when the catalogue is disabled', async () => {
    const { getRepairsSitemapEntries } = sitemapData;
    const from = vi.fn();

    await expect(
      getRepairsSitemapEntries({
        merchant: {
          id: 'merchant-1',
          is_published: true,
          slug: 'ogabassey',
          business_type: 'electronics',
          feature_settings: { repairs_catalog_enabled: false },
        },
        storeUrl: 'https://ogabassey.com',
        supabase: { from },
      } as unknown as StorefrontSitemapContext)
    ).resolves.toEqual([]);

    expect(from).not.toHaveBeenCalled();
  });
});
