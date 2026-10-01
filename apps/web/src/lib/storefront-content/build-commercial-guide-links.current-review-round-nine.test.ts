import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';
import type { PublishedClusterPost } from './content-cluster-types';

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

describe('buildCommercialGuideLinks current review round nine', () => {
  it('ranks the matching power-bank capacity above a newer sibling capacity', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      context: {
        pageKind: 'product',
        categorySlug: 'accessories',
        brands: ['Xiaomi'],
        productNames: ['Xiaomi 10000mAh Power Bank'],
      },
      posts: [
        post(
          'xiaomi-20000mah-power-bank',
          'Xiaomi 20000mAh Power Bank Buyer Guide',
          'Accessories',
          NEWER
        ),
        post(
          'xiaomi-10000mah-power-bank',
          'Xiaomi 10000mAh Power Bank Buyer Guide',
          'Accessories',
          OLDER
        ),
      ],
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/xiaomi-10000mah-power-bank'
    );
  });

  it('does not promote a compatibility brand on an explicit-brand PDP', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      context: {
        pageKind: 'product',
        categorySlug: 'accessories',
        brands: ['Samsung'],
        productNames: ['Samsung Case for Apple iPhone 15'],
      },
      posts: [
        post(
          'apple-case-iphone-15',
          'Apple Case for iPhone 15 Buyer Guide',
          'Accessories',
          NEWER
        ),
        post(
          'samsung-case-iphone-15',
          'Samsung Case for Apple iPhone 15 Buyer Guide',
          'Accessories',
          OLDER
        ),
      ],
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/samsung-case-iphone-15'
    );
  });
});
