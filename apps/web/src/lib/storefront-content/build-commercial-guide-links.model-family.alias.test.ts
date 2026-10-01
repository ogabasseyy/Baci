import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks alias-led family context', () => {
  it('boosts an alias-only Galaxy family guide above a newer generic Samsung guide', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'samsung-buyer-guide',
          title: 'Samsung Phones Buyer Guide',
          excerpt: 'How to choose a Samsung phone.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'galaxy-a-series-buyer-guide',
          title: 'Galaxy A Series Buyer Guide',
          excerpt: 'Galaxy A camera, battery, and performance expectations.',
          category: 'Smartphones',
          tags: ['smartphones', 'galaxy', 'a series'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'category',
        categorySlug: 'smartphones',
        brands: ['Samsung'],
        modelFamilySlug: 'galaxy-a-series',
        productSlugs: ['samsung-galaxy-a56'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/galaxy-a-series-buyer-guide',
      'https://ogabassey.com/blog/samsung-buyer-guide',
    ]);
  });
});
