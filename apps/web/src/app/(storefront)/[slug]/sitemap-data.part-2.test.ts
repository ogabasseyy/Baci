import { describe, expect, it } from 'vitest';
import {
  mockGetMerchantByIdentifier,
  mockHeaders,
  registerSitemapDataTests,
  setHostHeader,
  sitemapData,
} from './sitemap-data.test-setup';

describe('sitemap-data', () => {
  registerSitemapDataTests();

  it('falls back to the explicit slug when the request host is not a merchant domain', async () => {
    setHostHeader('preview.usebaci.com');
    mockGetMerchantByIdentifier
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
      });
    const { resolveStorefrontSitemapContext } = sitemapData;

    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers,
      'ogabassey'
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(1, 'preview');
    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(2, 'ogabassey');
    expect(context?.merchant.slug).toBe('ogabassey');
  });

  it('allows a real merchant slug named sitemap without header context', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      id: 'merchant-sitemap',
      slug: 'sitemap',
    });
    const { resolveStorefrontSitemapContext } = sitemapData;

    const context = await resolveStorefrontSitemapContext(
      mockHeaders as unknown as Headers,
      'sitemap'
    );

    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('sitemap');
    expect(context?.merchant.slug).toBe('sitemap');
  });

  it('returns static sitemap entries for the storefront root and faq', () => {
    const { getStaticSitemapEntries } = sitemapData;
    const entries = getStaticSitemapEntries({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
        updated_at: '2026-06-01T00:00:00Z',
      },
      storeUrl: 'https://ogabassey.com',
    } as unknown as Parameters<typeof getStaticSitemapEntries>[0]);

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://ogabassey.com',
        priority: 1,
        lastModified: new Date('2026-06-01T00:00:00Z'),
      }),
      expect.objectContaining({
        url: 'https://ogabassey.com/products',
        priority: 0.9,
        lastModified: new Date('2026-06-01T00:00:00Z'),
      }),
      expect.objectContaining({
        url: 'https://ogabassey.com/faq',
        priority: 0.5,
        lastModified: new Date('2026-06-01T00:00:00Z'),
      }),
    ]);
  });

  it('omits lastmod from static entries when the merchant has no updated_at', () => {
    const { getStaticSitemapEntries } = sitemapData;
    const entries = getStaticSitemapEntries({
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
      },
      storeUrl: 'https://ogabassey.com',
    } as unknown as Parameters<typeof getStaticSitemapEntries>[0]);

    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.lastModified).toBeUndefined();
    }
  });
});
