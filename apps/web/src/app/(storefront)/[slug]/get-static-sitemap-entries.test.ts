import { describe, expect, it } from 'vitest';
import { getStaticSitemapEntries } from './get-static-sitemap-entries';

describe('getStaticSitemapEntries', () => {
  it('fails closed for an unpublished storefront', () => {
    expect(
      getStaticSitemapEntries({
        merchant: { slug: 'zorvexa', is_published: false },
        storeUrl: 'https://zorvexa.usebaci.com',
      })
    ).toEqual([]);
  });

  it('returns the indexable home, products, and FAQ URLs', () => {
    expect(
      getStaticSitemapEntries({
        merchant: {
          slug: 'zorvexa',
          is_published: true,
          business_name: 'Zorvexa',
        },
        storeUrl: 'https://zorvexa.usebaci.com',
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://zorvexa.usebaci.com',
          priority: 1,
        }),
        expect.objectContaining({
          url: 'https://zorvexa.usebaci.com/products',
          priority: 0.9,
          changeFrequency: 'daily',
        }),
        expect.objectContaining({
          url: 'https://zorvexa.usebaci.com/faq',
          priority: 0.5,
        }),
      ])
    );
  });

  it('gates /about on merchant about content or ogabassey template', () => {
    const withOgabasseyTemplate = getStaticSitemapEntries({
      merchant: {
        slug: 'ogabassey',
        is_published: true,
        business_name: 'Ogabassey',
        template_id: 'ogabassey',
      },
      storeUrl: 'https://ogabassey.com',
    });
    expect(withOgabasseyTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://ogabassey.com/about',
          priority: 0.6,
          changeFrequency: 'monthly',
        }),
      ])
    );

    const withRenderedAbout = getStaticSitemapEntries({
      merchant: {
        slug: 'store1',
        is_published: true,
        business_name: 'Store 1',
        about_page: { story: 'Our brand story' },
      },
      storeUrl: 'https://store1.usebaci.com',
    });
    expect(withRenderedAbout).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://store1.usebaci.com/about' }),
      ])
    );

    const withLegacyAbout = getStaticSitemapEntries({
      merchant: {
        slug: 'store2',
        is_published: true,
        business_name: 'Store 2',
        pages: { about: '<p>About us content</p>' },
      },
      storeUrl: 'https://store2.usebaci.com',
    });
    expect(withLegacyAbout).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://store2.usebaci.com/about' }),
      ])
    );

    const withoutAbout = getStaticSitemapEntries({
      merchant: {
        slug: 'store3',
        is_published: true,
        business_name: 'Store 3',
      },
      storeUrl: 'https://store3.usebaci.com',
    });
    expect(withoutAbout.some((entry) => entry.url.endsWith('/about'))).toBe(
      false
    );
  });

  it('gates /contact on contact information existence', () => {
    const withEmail = getStaticSitemapEntries({
      merchant: {
        slug: 'store-contact',
        is_published: true,
        business_name: 'Store Contact',
        email: 'info@store.com',
      },
      storeUrl: 'https://store.usebaci.com',
    });
    expect(withEmail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://store.usebaci.com/contact',
          priority: 0.6,
          changeFrequency: 'monthly',
        }),
      ])
    );

    const withPhone = getStaticSitemapEntries({
      merchant: {
        slug: 'store-phone',
        is_published: true,
        business_name: 'Store Phone',
        phone: '+2348000000000',
      },
      storeUrl: 'https://store.usebaci.com',
    });
    expect(withPhone).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://store.usebaci.com/contact' }),
      ])
    );

    const withPageContact = getStaticSitemapEntries({
      merchant: {
        slug: 'store-page',
        is_published: true,
        business_name: 'Store Page',
        pages: { contact: 'Reach us here' },
      },
      storeUrl: 'https://store.usebaci.com',
    });
    expect(withPageContact).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://store.usebaci.com/contact' }),
      ])
    );

    const withoutContact = getStaticSitemapEntries({
      merchant: {
        slug: 'store-empty',
        is_published: true,
        business_name: 'Store Empty',
      },
      storeUrl: 'https://store.usebaci.com',
    });
    expect(withoutContact.some((entry) => entry.url.endsWith('/contact'))).toBe(
      false
    );
  });
});
