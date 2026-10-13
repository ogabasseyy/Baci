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

describe('buildCommercialGuideLinks current review round four', () => {
  it('uses paired-slug storage variants to rank an exact comparison', () => {
    const result = firstGuide(
      {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15', 'Apple iPhone 16'],
        productSlugs: ['apple-iphone-15-256gb', 'apple-iphone-16-128gb'],
      },
      [
        post(
          'wrong-storage-comparison',
          'Apple iPhone 15 128GB vs Apple iPhone 16 256GB',
          'Smartphones',
          NEWER
        ),
        post(
          'exact-storage-comparison',
          'Apple iPhone 15 256GB vs Apple iPhone 16 128GB',
          'Smartphones',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/exact-storage-comparison');
  });

  it('requires all PDP groups for the exact variant boost', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'tablets',
        brands: ['Apple'],
        productNames: ['Apple iPad 10 Wi-Fi 256GB'],
      },
      [
        post(
          'ipad-10-256gb',
          'Apple iPad 10 256GB Buyer Guide',
          'Tablets',
          NEWER
        ),
        post(
          'ipad-10-wifi-256gb',
          'Apple iPad 10 Wi-Fi 256GB Buyer Guide',
          'Tablets',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/ipad-10-wifi-256gb');
  });

  it('rejects a reversed subset/superset connectivity comparison', () => {
    const result = firstGuide(
      {
        pageKind: 'compare',
        categorySlug: 'tablets',
        brands: ['Apple'],
        productNames: ['Apple iPad 10 Wi-Fi', 'Apple iPad 10 Wi-Fi Cellular'],
      },
      [
        post(
          'wrong-ipad-comparison',
          'Apple iPad 10 Wi-Fi Cellular vs Apple iPad 10 Comparison',
          'Tablets',
          NEWER
        ),
        post(
          'exact-ipad-comparison',
          'Apple iPad 10 Wi-Fi vs Apple iPad 10 Wi-Fi Cellular',
          'Tablets',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/exact-ipad-comparison');
  });

  it('keeps exact compare colors distinct from newer sibling colors', () => {
    const result = firstGuide(
      {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 Black', 'Apple iPhone 15 Blue'],
      },
      [
        post(
          'iphone-15-red-vs-green',
          'Apple iPhone 15 Red vs Green Comparison',
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

  it('ranks the exact numeric laptop-family comparison', () => {
    const result = firstGuide(
      {
        pageKind: 'compare',
        categorySlug: 'laptops',
        brands: ['Dell'],
        productNames: ['Dell XPS 13 9340', 'Dell XPS 14 9340'],
      },
      [
        post(
          'generic-xps-comparison',
          'Dell XPS 9340 Laptop Comparison',
          'Laptops',
          NEWER
        ),
        post(
          'xps-13-vs-14-9340',
          'Dell XPS 13 9340 vs Dell XPS 14 9340',
          'Laptops',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/xps-13-vs-14-9340');
  });

  it('uses an aligned slug to rank a numeric laptop-family guide', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'laptops',
        brands: ['Dell'],
        productNames: ['Dell XPS'],
        productSlugs: ['dell-xps-13-9340'],
      },
      [
        post('generic-dell-guide', 'Dell Laptop Buyer Guide', 'Laptops', NEWER),
        post(
          'dell-xps-13-9340-guide',
          'Dell XPS 13 9340 Buyer Guide',
          'Laptops',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/dell-xps-13-9340-guide');
  });

  it('ranks a configured sibling-brand guide from the product name', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Xiaomi'],
        productNames: ['Redmi Note 13'],
      },
      [
        post(
          'generic-xiaomi-guide',
          'Xiaomi Phones Buyer Guide',
          'Smartphones',
          NEWER
        ),
        post(
          'redmi-note-13-guide',
          'Redmi Note 13 Buyer Guide',
          'Smartphones',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/redmi-note-13-guide');
  });
});
