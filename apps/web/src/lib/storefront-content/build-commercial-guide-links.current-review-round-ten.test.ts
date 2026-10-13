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
    tags: [category, 'buyer guide'],
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

describe('buildCommercialGuideLinks current review round ten', () => {
  it('ranks the exact power-bank comparison above a newer sibling comparison', () => {
    const result = firstGuide(
      {
        pageKind: 'compare',
        categorySlug: 'accessories',
        brands: ['Xiaomi'],
        productNames: [
          'Xiaomi 10000mAh Power Bank',
          'Xiaomi 20000mAh Power Bank',
        ],
      },
      [
        post(
          'xiaomi-20000mah-vs-30000mah',
          'Xiaomi 20000mAh Power Bank vs Xiaomi 30000mAh Power Bank Comparison',
          'Accessories',
          NEWER
        ),
        post(
          'xiaomi-10000mah-vs-20000mah',
          'Xiaomi 10000mAh Power Bank vs Xiaomi 20000mAh Power Bank Comparison',
          'Accessories',
          OLDER
        ),
      ]
    );

    expect(result).toBe(
      'https://ogabassey.com/blog/xiaomi-10000mah-vs-20000mah'
    );
  });

  it('ranks the matching quote-only display size above a newer sibling size', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'laptops',
        brands: ['Apple'],
        productNames: ['Apple MacBook Pro M3 14”'],
        productSlugs: ['legacy-macbook-42'],
      },
      [
        post(
          'macbook-pro-m3-16-inch',
          'Apple MacBook Pro M3 16-inch Buyer Guide',
          'Laptops',
          NEWER
        ),
        post(
          'macbook-pro-m3-14-inch',
          'Apple MacBook Pro M3 14-inch Buyer Guide',
          'Laptops',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/macbook-pro-m3-14-inch');
  });

  it('ranks a trailing model digit after a leading convertible descriptor', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'laptops',
        brands: ['Microsoft'],
        productNames: ['Microsoft 2-in-1 Surface Pro 9'],
      },
      [
        post(
          'surface-pro-convertible',
          'Microsoft 2-in-1 Surface Pro Buyer Guide',
          'Laptops',
          NEWER
        ),
        post(
          'surface-pro-9-convertible',
          'Microsoft 2-in-1 Surface Pro 9 Buyer Guide',
          'Laptops',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/surface-pro-9-convertible');
  });
});
