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

describe('buildCommercialGuideLinks current review round five', () => {
  it('ranks the exact decimal display-size guide', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'tablets',
        brands: ['Apple'],
        productNames: ['Apple iPad Pro 12.9 inch'],
      },
      [
        post(
          'ipad-pro-11',
          'Apple iPad Pro 11 inch Buyer Guide',
          'Tablets',
          NEWER
        ),
        post(
          'ipad-pro-12-9',
          'Apple iPad Pro 12.9 inch Buyer Guide',
          'Tablets',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/ipad-pro-12-9');
  });

  it('ranks the exact stripped color-suffix guide', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 Midnight'],
      },
      [
        post(
          'iphone-15-blue',
          'Apple iPhone 15 Blue Buyer Guide',
          'Smartphones',
          NEWER
        ),
        post(
          'iphone-15-midnight',
          'Apple iPhone 15 Midnight Buyer Guide',
          'Smartphones',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/iphone-15-midnight');
  });

  it('uses aligned tablet slug storage instead of labeled RAM', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'tablets',
        brands: ['Samsung'],
        productNames: ['Samsung Galaxy Tab A9 4GB RAM'],
        productSlugs: ['samsung-galaxy-tab-a9-64gb'],
      },
      [
        post(
          'tab-a9-4gb',
          'Samsung Galaxy Tab A9 4GB Buyer Guide',
          'Tablets',
          NEWER
        ),
        post(
          'tab-a9-64gb',
          'Samsung Galaxy Tab A9 64GB Buyer Guide',
          'Tablets',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/tab-a9-64gb');
  });

  it('ranks the exact monitor refresh-rate guide', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'monitors',
        brands: ['Samsung'],
        productNames: ['Samsung Odyssey G5 144Hz'],
      },
      [
        post(
          'odyssey-g5-240hz',
          'Samsung Odyssey G5 240Hz Buyer Guide',
          'Monitors',
          NEWER
        ),
        post(
          'odyssey-g5-144hz',
          'Samsung Odyssey G5 144Hz Buyer Guide',
          'Monitors',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/odyssey-g5-144hz');
  });

  it('ranks the exact monitor refresh-rate comparison with shorthand', () => {
    const result = firstGuide(
      {
        pageKind: 'compare',
        categorySlug: 'monitors',
        brands: ['Samsung'],
        productNames: ['Samsung Odyssey G5 144Hz', 'Samsung Odyssey G5 240Hz'],
      },
      [
        post(
          'odyssey-g5-240-vs-360',
          'Samsung Odyssey G5 240Hz vs Samsung Odyssey G5 360Hz Comparison',
          'Monitors',
          NEWER
        ),
        post(
          'odyssey-g5-144-vs-240',
          'Samsung Odyssey G5 144Hz vs 240Hz Comparison',
          'Monitors',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/odyssey-g5-144-vs-240');
  });
});
