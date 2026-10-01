import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks laptop processor suffixes', () => {
  it('ranks the exact XPS model guide above a newer generic Dell guide', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'dell-xps-14-9340-guide',
          title: 'Dell XPS 14 9340 Buyer Guide',
          excerpt: 'Buying advice for the sibling Dell XPS 14 9340.',
          category: 'Laptops',
          tags: ['laptops', 'dell', 'xps'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-18T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'dell-laptop-buyer-guide',
          title: 'Dell Laptop Buyer Guide',
          excerpt: 'General advice for choosing a Dell laptop.',
          category: 'Laptops',
          tags: ['laptops', 'dell'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'dell-xps-13-9340-guide',
          title: 'Dell XPS 13 9340 Buyer Guide',
          excerpt: 'Buying advice for the Dell XPS 13 9340.',
          category: 'Laptops',
          tags: ['laptops', 'dell', 'xps'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'laptops',
        brands: ['Dell'],
        productNames: ['Dell XPS 13 9340 Intel Core Ultra 7 32GB'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/dell-xps-13-9340-guide'
    );
  });
});
