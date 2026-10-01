import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks edge cases', () => {
  it('does not treat an empty normalized brand as a direct brand match', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'smartphone-guide',
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
          slug: '15-best-smartphones-guide',
          title: '15 Best Smartphones Buyer Guide',
          excerpt: 'The best smartphones to consider.',
          category: 'Smartphones',
          tags: ['smartphones'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'category',
        categorySlug: 'smartphones',
        brands: ['!!!'],
        productSlugs: ['iphone-15'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/smartphone-guide',
      'https://ogabassey.com/blog/15-best-smartphones-guide',
    ]);
  });
});
