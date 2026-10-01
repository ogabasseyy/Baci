import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks PDP storage variants', () => {
  it('ranks the matching storage guide above a newer sibling guide', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'apple-iphone-15-128gb-buyer-guide',
          title: 'Apple iPhone 15 128GB Buyer Guide',
          excerpt: 'Buying advice for the 128GB model.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple', 'iphone 15'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'apple-iphone-15-256gb-buyer-guide',
          title: 'Apple iPhone 15 256GB Buyer Guide',
          excerpt: 'Buying advice for the 256GB model.',
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
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 256GB'],
        productSlugs: ['apple-iphone-15-256gb'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/apple-iphone-15-256gb-buyer-guide',
      'https://ogabassey.com/blog/apple-iphone-15-128gb-buyer-guide',
    ]);
  });

  it('ranks a 32GB phone guide above a newer 64GB sibling guide', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'samsung-a05-64gb-guide',
          title: 'Samsung A05 64GB Buyer Guide',
          excerpt: 'Buying advice for the 64GB model.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'a05'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'samsung-a05-32gb-guide',
          title: 'Samsung A05 32GB Buyer Guide',
          excerpt: 'Buying advice for the 32GB model.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'a05'],
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
        productNames: ['Samsung A05 4GB 32GB'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/samsung-a05-32gb-guide'
    );
  });
});
