import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';
import type { PublishedClusterPost } from './content-cluster-types';

function post(
  slug: string,
  title: string,
  category: string,
  publishedAt: string
): PublishedClusterPost {
  return {
    slug,
    title,
    excerpt: 'Product-specific buying advice.',
    category,
    tags: [category.toLowerCase(), 'buyer guide'],
    keywords: ['buyer guide'],
    featured_image_url: null,
    published_at: publishedAt,
    reading_time_minutes: 6,
  };
}

const NEWER = '2026-04-12T09:00:00.000Z';
const OLDER = '2026-04-01T09:00:00.000Z';

describe('buildCommercialGuideLinks variant regressions', () => {
  it('ranks a Wi-Fi-only PDP guide above a newer Wi-Fi Cellular sibling', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post(
          'ipad-10-wifi-cellular-guide',
          'Apple iPad 10 Wi-Fi Cellular Buyer Guide',
          'Tablets',
          NEWER
        ),
        post(
          'ipad-10-wifi-guide',
          'Apple iPad 10 Wi-Fi Buyer Guide',
          'Tablets',
          OLDER
        ),
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'tablets',
        brands: ['Apple'],
        productNames: ['Apple iPad 10 Wi-Fi'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/ipad-10-wifi-guide'
    );
  });

  it('ranks a GPS watch guide above a newer GPS Cellular sibling', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post(
          'apple-watch-9-gps-cellular-guide',
          'Apple Watch Series 9 GPS Cellular Buyer Guide',
          'Smartwatches',
          NEWER
        ),
        post(
          'apple-watch-9-gps-guide',
          'Apple Watch Series 9 GPS Buyer Guide',
          'Smartwatches',
          OLDER
        ),
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartwatches',
        brands: ['Apple'],
        productNames: ['Apple Watch Series 9 45mm GPS'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/apple-watch-9-gps-guide'
    );
  });

  it('ranks shorthand same-model comparisons above newer standalone guides', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post(
          'iphone-15-storage-guide',
          'Apple iPhone 15 Storage Buyer Guide',
          'Smartphones',
          NEWER
        ),
        post(
          'iphone-15-128gb-vs-256gb',
          'Apple iPhone 15 128GB vs 256GB Comparison',
          'Smartphones',
          OLDER
        ),
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 128GB', 'Apple iPhone 15 256GB'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/iphone-15-128gb-vs-256gb'
    );
  });

  it('ranks text-only model comparisons above newer standalone guides', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post(
          'galaxy-buds-pro-guide',
          'Samsung Galaxy Buds Pro Buyer Guide',
          'Earbuds',
          NEWER
        ),
        post(
          'galaxy-buds-pro-black-vs-white',
          'Samsung Galaxy Buds Pro Black & Samsung Galaxy Buds Pro White Comparison',
          'Earbuds',
          OLDER
        ),
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'earbuds',
        brands: ['Samsung'],
        productNames: [
          'Samsung Galaxy Buds Pro Black',
          'Samsung Galaxy Buds Pro White',
        ],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/galaxy-buds-pro-black-vs-white'
    );
  });

  it('prefers an extended paired slug model over a less-specific name', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post(
          'iphone-15-guide',
          'Apple iPhone 15 Buyer Guide',
          'Smartphones',
          NEWER
        ),
        post(
          'iphone-15-pro-guide',
          'Apple iPhone 15 Pro Buyer Guide',
          'Smartphones',
          OLDER
        ),
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15'],
        productSlugs: ['apple-iphone-15-pro'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/iphone-15-pro-guide'
    );
  });
});
