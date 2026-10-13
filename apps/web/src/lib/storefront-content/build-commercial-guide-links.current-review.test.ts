import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';
import type {
  BuildCommercialGuideLinksContext,
  PublishedClusterPost,
} from './content-cluster-types';

const NEWER = '2026-04-12T09:00:00.000Z';
const OLDER = '2026-04-01T09:00:00.000Z';

function post(
  slug: string,
  title: string,
  category: string,
  publishedAt: string
): PublishedClusterPost {
  return {
    slug,
    title,
    excerpt: title,
    category,
    tags: [category.toLowerCase(), 'buyer guide'],
    keywords: ['buyer guide'],
    featured_image_url: null,
    published_at: publishedAt,
    reading_time_minutes: 6,
  };
}

function firstGuide(
  context: BuildCommercialGuideLinksContext,
  posts: PublishedClusterPost[]
) {
  return buildCommercialGuideLinks({
    storeUrl: 'https://ogabassey.com',
    context,
    posts,
  })[0]?.href;
}

describe('buildCommercialGuideLinks current review regressions', () => {
  it('matches a USD guide to a catalog denomination written as US$50', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'gift-cards',
        brands: ['PlayStation'],
        productNames: ['PSN Card US$50'],
      },
      [
        post(
          'generic-psn-guide',
          'PSN Gift Card Buyer Guide',
          'Gift Cards',
          NEWER
        ),
        post(
          'psn-usd-50-guide',
          'USD 50 PSN Card Buyer Guide',
          'Gift Cards',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/psn-usd-50-guide');
  });

  it('ranks an Xbox Series X/S shorthand comparison above a generic guide', () => {
    const result = firstGuide(
      {
        pageKind: 'compare',
        categorySlug: 'xbox',
        brands: ['Xbox'],
        productNames: ['Xbox Series X', 'Xbox Series S'],
      },
      [
        post(
          'generic-xbox-guide',
          'Xbox Console Comparison Guide',
          'Xbox',
          NEWER
        ),
        post('xbox-series-x-vs-s', 'Xbox Series X|S Comparison', 'Xbox', OLDER),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/xbox-series-x-vs-s');
  });

  it('matches a PDP connectivity group regardless of guide token order', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'tablets',
        brands: ['Apple'],
        productNames: ['Apple iPad 10 Wi-Fi Cellular'],
      },
      [
        post('generic-ipad-guide', 'Apple iPad Buyer Guide', 'Tablets', NEWER),
        post(
          'ipad-cellular-wifi',
          'Apple iPad 10 Cellular Wi-Fi Buyer Guide',
          'Tablets',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/ipad-cellular-wifi');
  });

  it('relaxes platform ordering for gaming accessory product guides', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'gaming-accessories',
        brands: ['PlayStation'],
        productNames: ['PlayStation DualSense Controller'],
      },
      [
        post(
          'generic-ps5-accessories',
          'PS5 Gaming Accessories Buyer Guide',
          'Gaming Accessories',
          NEWER
        ),
        post(
          'dualsense-guide',
          'DualSense Buyer Guide for PS5',
          'Gaming Accessories',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/dualsense-guide');
  });

  it('rejects a wrong-storage shorthand guide for a product variant', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 Pro 256GB'],
      },
      [
        post(
          'iphone-15-128-vs-pro',
          'Apple iPhone 15 128GB vs Pro Comparison',
          'Smartphones',
          NEWER
        ),
        post(
          'iphone-15-pro-256',
          'Apple iPhone 15 Pro 256GB Buyer Guide',
          'Smartphones',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/iphone-15-pro-256');
  });
});
