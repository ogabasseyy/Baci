import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks alias-led model distinctions', () => {
  it('boosts an alias-led ThinkPad model guide above a newer generic Lenovo guide', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'lenovo-buyer-guide',
          title: 'Lenovo Laptop Buyer Guide',
          excerpt: 'Lenovo laptop buying advice.',
          category: 'Laptops',
          tags: ['laptops', 'lenovo'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'thinkpad-t14-gen-4-buyer-guide',
          title: 'ThinkPad T14 Gen 4 Buyer Guide',
          excerpt: 'ThinkPad T14 Gen 4 buying advice.',
          category: 'Laptops',
          tags: ['laptops', 'thinkpad', 't14 gen 4'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'laptops',
        brands: ['Lenovo'],
        productNames: ['Lenovo ThinkPad T14 Gen 4'],
        productSlugs: [],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/thinkpad-t14-gen-4-buyer-guide'
    );
  });
});
