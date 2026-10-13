import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks product brand binding', () => {
  it('does not boost a shared model phrase under the wrong brand', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'redmi-note-14-pro-vs-iphone-13-guide',
          title: 'Redmi Note 14 Pro vs Apple iPhone 13 Buyer Guide',
          excerpt: 'Compare Redmi Note 14 Pro with Apple iPhone 13.',
          category: 'Smartphones',
          tags: ['smartphones', 'redmi', 'apple'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'iphone-14-pro-buyer-guide',
          title: 'Apple iPhone 14 Pro Buyer Guide',
          excerpt: 'What to know before buying Apple iPhone 14 Pro.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple', 'iphone 14 pro'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 14 Pro'],
        productSlugs: ['apple-iphone-14-pro'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/iphone-14-pro-buyer-guide'
    );
  });

  it('does not boost a compare guide when a model precedes its brand', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'watch-ultra-apple-vs-samsung-guide',
          title: 'Watch Ultra Apple vs Samsung Watch Ultra Buyer Guide',
          excerpt: 'A comparison of these flagship smartwatches.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'apple', 'samsung', 'comparison'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'apple-watch-ultra-vs-samsung-watch-ultra-guide',
          title: 'Apple Watch Ultra vs Samsung Watch Ultra Buyer Guide',
          excerpt: 'A comparison of these flagship smartwatches.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'apple', 'samsung', 'comparison'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartwatches',
        brands: ['Apple', 'Samsung'],
        productNames: ['Apple Watch Ultra', 'Samsung Watch Ultra'],
        productSlugs: ['apple-watch-ultra', 'samsung-watch-ultra'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/apple-watch-ultra-vs-samsung-watch-ultra-guide'
    );
  });

  it('derives a missing PDP brand from a branded product name for numeric models', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'generic-smartphone-guide',
          title: 'Smartphone Buyer Guide',
          excerpt: 'How to choose a smartphone.',
          category: 'Smartphones',
          tags: ['smartphones'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'apple-iphone-15-buyer-guide',
          title: 'Apple iPhone 15 Buyer Guide',
          excerpt: 'Apple iPhone 15 buying advice.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple', 'iphone 15'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartphones',
        productNames: ['Apple iPhone 15'],
        productSlugs: [],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/apple-iphone-15-buyer-guide'
    );
  });

  it('ranks the matching PDP connectivity variant above a newer sibling guide', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'samsung-a15-lte-guide',
          title: 'Samsung A15 LTE Buyer Guide',
          excerpt: 'A guide to the LTE variant.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'a15'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'samsung-a15-5g-guide',
          title: 'Samsung A15 5G Buyer Guide',
          excerpt: 'A guide to the 5G variant.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'a15'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Samsung'],
        productNames: ['Samsung A15 5G 4GB 128GB'],
        productSlugs: ['samsung-a15-5g-4gb-128gb'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/samsung-a15-5g-guide',
      'https://ogabassey.com/blog/samsung-a15-lte-guide',
    ]);
  });

  it('retains every PDP connectivity marker for Wi-Fi cellular models', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'ipad-10th-gen-wifi-guide',
          title: 'Apple iPad 10th Gen Wi-Fi Buyer Guide',
          excerpt: 'Buying advice for the Wi-Fi model.',
          category: 'Tablets',
          tags: ['tablets', 'apple'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'ipad-10th-gen-wifi-cellular-guide',
          title: 'Apple iPad 10th Gen Wi-Fi Cellular Buyer Guide',
          excerpt: 'Buying advice for the Wi-Fi and cellular model.',
          category: 'Tablets',
          tags: ['tablets', 'apple'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'tablets',
        brands: ['Apple'],
        productNames: ['Apple iPad 10th Gen 2022 256GB Wi-Fi + Cellular'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/ipad-10th-gen-wifi-cellular-guide',
      'https://ogabassey.com/blog/ipad-10th-gen-wifi-guide',
    ]);
  });

  it('matches singular Airpod catalog names with singular guide titles', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'apple-earbuds-buyer-guide',
          title: 'Apple Earbuds Buyer Guide',
          excerpt: 'Buying advice for Apple earbuds.',
          category: 'Earbuds',
          tags: ['earbuds', 'apple'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'apple-airpod-2-buyer-guide',
          title: 'Apple AirPod 2 Buyer Guide',
          excerpt: 'Buying advice for Apple AirPod 2.',
          category: 'Earbuds',
          tags: ['earbuds', 'apple'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'earbuds',
        brands: ['Apple'],
        productNames: ['Apple Airpod 2'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/apple-airpod-2-buyer-guide'
    );
  });
});
