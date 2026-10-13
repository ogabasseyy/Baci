import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks compare brand binding', () => {
  it('does not treat one unqualified collision as both compared brands', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'apple-and-samsung-watch-ultra-guide',
          title: 'Apple and Samsung Watch Ultra Buyer Guide',
          excerpt: 'A single guide to the shared watch ultra category.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'apple', 'samsung'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'apple-watch-ultra-vs-samsung-watch-ultra',
          title: 'Apple Watch Ultra vs Samsung Watch Ultra Buyer Guide',
          excerpt: 'Compare Apple Watch Ultra and Samsung Watch Ultra.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'apple', 'samsung', 'watch ultra'],
          keywords: ['comparison'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartwatches',
        brands: ['Apple', 'Samsung'],
        productSlugs: ['apple-watch-ultra-49mm', 'samsung-watch-ultra'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/apple-watch-ultra-vs-samsung-watch-ultra',
      'https://ogabassey.com/blog/apple-and-samsung-watch-ultra-guide',
    ]);
  });

  it('qualifies a canonical brand through its configured alias', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'samsung-galaxy-watch-ultra-guide',
          title: 'Samsung Galaxy Watch Ultra Buyer Guide',
          excerpt: 'A guide to Samsung smartwatch features.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'samsung'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'galaxy-watch-ultra-vs-apple-watch-ultra',
          title: 'Galaxy Watch Ultra vs Apple Watch Ultra Buyer Guide',
          excerpt: 'Compare Galaxy Watch Ultra and Apple Watch Ultra.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'apple', 'galaxy'],
          keywords: ['comparison'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartwatches',
        brands: ['Apple', 'Samsung'],
        productSlugs: ['apple-watch-ultra-49mm', 'samsung-watch-ultra'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/galaxy-watch-ultra-vs-apple-watch-ultra',
      'https://ogabassey.com/blog/samsung-galaxy-watch-ultra-guide',
    ]);
  });

  it('does not treat the canonical Redmi brand as a Xiaomi alias in comparisons', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'redmi-14t-vs-galaxy-s25-guide',
          title: 'Redmi 14T vs Samsung Galaxy S25 Buyer Guide',
          excerpt: 'Compare Redmi 14T with Samsung Galaxy S25.',
          category: 'Smartphones',
          tags: ['smartphones', 'redmi', 'samsung', 'comparison'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'xiaomi-14t-vs-galaxy-s25-guide',
          title: 'Xiaomi 14T vs Samsung Galaxy S25 Buyer Guide',
          excerpt: 'Compare Xiaomi 14T with Samsung Galaxy S25.',
          category: 'Smartphones',
          tags: ['smartphones', 'xiaomi', 'samsung', 'comparison'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Xiaomi', 'Samsung'],
        productNames: ['Xiaomi 14T', 'Samsung Galaxy S25'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/xiaomi-14t-vs-galaxy-s25-guide',
      'https://ogabassey.com/blog/redmi-14t-vs-galaxy-s25-guide',
    ]);
  });

  it('binds a brand omitted from its aligned product name and slug', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'iphone-15-vs-samsung-phone-2',
          title: 'Apple iPhone 15 vs Samsung Phone 2 Buyer Guide',
          excerpt: 'Compare the two phones.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple', 'samsung'],
          keywords: ['comparison'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'iphone-15-vs-nothing-phone-2',
          title: 'Apple iPhone 15 vs Nothing Phone 2 Buyer Guide',
          excerpt: 'Compare Apple iPhone 15 with Nothing Phone 2.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple', 'nothing'],
          keywords: ['comparison'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple', 'Nothing'],
        productBrands: ['Apple', 'Nothing'],
        productNames: ['iPhone 15', 'Phone 2'],
        productSlugs: ['iphone-15', 'phone-2'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/iphone-15-vs-nothing-phone-2'
    );
  });
});
