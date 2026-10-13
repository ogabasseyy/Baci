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

describe('buildCommercialGuideLinks current review round three', () => {
  it('ranks a color-only shorthand comparison above a standalone guide', () => {
    const result = firstGuide(
      {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 Black', 'Apple iPhone 15 Blue'],
      },
      [
        post(
          'iphone-15-guide',
          'Apple iPhone 15 Buyer Guide',
          'Smartphones',
          NEWER
        ),
        post(
          'iphone-15-black-vs-blue',
          'Apple iPhone 15 Black vs Blue Comparison',
          'Smartphones',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/iphone-15-black-vs-blue');
  });

  it('ranks exact distinct-model storage variants above a wrong comparison', () => {
    const result = firstGuide(
      {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 Pro 256GB', 'Apple iPhone 16 128GB'],
      },
      [
        post(
          'wrong-storage-comparison',
          'Apple iPhone 15 Pro 128GB vs Apple iPhone 16 256GB',
          'Smartphones',
          NEWER
        ),
        post(
          'exact-storage-comparison',
          'Apple iPhone 15 Pro 256GB vs Apple iPhone 16 128GB',
          'Smartphones',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/exact-storage-comparison');
  });

  it('does not boost a Pro Max shorthand guide for the Pro PDP', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 Pro'],
      },
      [
        post(
          'iphone-15-vs-pro-max',
          'Apple iPhone 15 vs Pro Max Comparison',
          'Smartphones',
          NEWER
        ),
        post(
          'iphone-15-pro-guide',
          'Apple iPhone 15 Pro Buyer Guide',
          'Smartphones',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/iphone-15-pro-guide');
  });
});
