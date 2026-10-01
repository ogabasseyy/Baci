import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks color-only compare variants', () => {
  it('does not let one standalone model occurrence satisfy both products', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'iphone-15-buyer-guide',
          title: 'Apple iPhone 15 Buyer Guide',
          excerpt: 'Buying advice for iPhone 15 colors.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'iphone-15-black-vs-blue',
          title: 'Apple iPhone 15 Black vs Apple iPhone 15 Blue',
          excerpt: 'Compare both iPhone 15 color options.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple'],
          keywords: ['comparison'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 Black', 'Apple iPhone 15 Blue'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/iphone-15-black-vs-blue'
    );
  });
});
