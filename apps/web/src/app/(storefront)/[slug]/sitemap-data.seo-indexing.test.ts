import { describe, expect, it } from 'vitest';
import {
  getCommercialSupportSitemapEntries,
  getNamedSitemapEntries,
  getProductSitemapEntries,
  getRepairsSitemapEntries,
  getSitemapIndexLinks,
  getStaticSitemapEntries,
} from './sitemap-data';

describe('storefront sitemap SEO indexing', () => {
  it('omits static URLs for an unpublished merchant', () => {
    expect(
      getStaticSitemapEntries({
        merchant: { is_published: false },
        storeUrl: 'https://zorvexa.usebaci.com',
      } as never)
    ).toEqual([]);
  });

  it('omits every child sitemap link for an unpublished merchant', () => {
    expect(
      getSitemapIndexLinks({
        merchant: {
          id: 'merchant-1',
          slug: 'zorvexa',
          is_published: false,
          feature_settings: {
            blog_enabled: true,
            repairs_catalog_enabled: true,
          },
        },
        storeUrl: 'https://zorvexa.usebaci.com',
      } as never)
    ).toEqual([]);
  });

  it('blocks every named sitemap family before an unpublished store can query', async () => {
    const context = {
      merchant: {
        id: 'merchant-1',
        slug: 'zorvexa',
        is_published: false,
        feature_settings: {
          blog_enabled: true,
          repairs_catalog_enabled: true,
        },
      },
      storeUrl: 'https://zorvexa.usebaci.com',
      supabase: {
        from: () => {
          throw new Error('unpublished sitemap must not query');
        },
      },
    } as never;

    await expect(
      Promise.all(
        [
          'static',
          'products',
          'categories',
          'brand-authority',
          'commercial-support',
          'repairs',
        ].map(async (id) => getNamedSitemapEntries(context, id))
      )
    ).resolves.toEqual([[], [], [], [], [], []]);
  });

  it('blocks direct commercial support entries for an unpublished store', async () => {
    await expect(
      getCommercialSupportSitemapEntries({
        merchant: { id: 'merchant-1', slug: 'zorvexa', is_published: false },
        storeUrl: 'https://zorvexa.usebaci.com',
        supabase: {
          from: () => {
            throw new Error('unpublished commercial sitemap must not query');
          },
        },
      } as never)
    ).resolves.toEqual([]);
  });

  it('blocks direct repairs entries for an unpublished store', async () => {
    await expect(
      getRepairsSitemapEntries({
        merchant: {
          id: 'merchant-1',
          slug: 'zorvexa',
          is_published: false,
          business_type: 'electronics',
          feature_settings: { repairs_catalog_enabled: true },
        },
        storeUrl: 'https://zorvexa.usebaci.com',
        supabase: {
          from: () => {
            throw new Error('unpublished repairs sitemap must not query');
          },
        },
      } as never)
    ).resolves.toEqual([]);
  });

  it('keeps the named published home sitemap entry without product prerequisites', () => {
    expect(
      getStaticSitemapEntries({
        merchant: {
          is_published: true,
          business_name: 'Zorvexa',
          slug: 'zorvexa',
        },
        storeUrl: 'https://zorvexa.usebaci.com',
      } as never)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://zorvexa.usebaci.com' }),
      ])
    );
  });

  it('omits static URLs when the real merchant name is missing', () => {
    expect(
      getStaticSitemapEntries({
        merchant: { is_published: true, business_name: ' ', slug: 'zorvexa' },
        storeUrl: 'https://zorvexa.usebaci.com',
      } as never)
    ).toEqual([]);
  });

  it('omits a published active product when its persisted name is blank', async () => {
    const rows = [
      {
        id: 'product-1',
        name: ' ',
        slug: 'fallback-slug',
        category: null,
        canonical_url: null,
        images: [],
        updated_at: null,
        categories: null,
      },
    ];
    const query = {
      eq: () => query,
      order: () => query,
      range: () => ({ data: rows, error: null }),
    };

    await expect(
      getProductSitemapEntries({
        merchant: { id: 'merchant-1', slug: 'zorvexa', is_published: true },
        storeUrl: 'https://zorvexa.usebaci.com',
        supabase: { from: () => ({ select: () => query }) },
      } as never)
    ).resolves.toEqual([]);
  });
});
