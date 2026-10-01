import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

function post(slug: string, title: string, publishedAt: string) {
  return {
    slug,
    title,
    excerpt: 'Product-specific buying advice.',
    category: 'Tablets',
    tags: ['tablets', 'apple'],
    keywords: ['buyer guide'],
    featured_image_url: null,
    published_at: publishedAt,
    reading_time_minutes: 6,
  };
}

describe('buildCommercialGuideLinks combined PDP variants', () => {
  it('ranks the matching storage guide when connectivity is shared', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post(
          'ipad-10-wifi-128gb-guide',
          'Apple iPad 10 Wi-Fi 128GB Buyer Guide',
          '2026-04-12T09:00:00.000Z'
        ),
        post(
          'ipad-10-wifi-256gb-guide',
          'Apple iPad 10 Wi-Fi 256GB Buyer Guide',
          '2026-04-01T09:00:00.000Z'
        ),
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'tablets',
        brands: ['Apple'],
        productNames: ['Apple iPad 10 Wi-Fi 256GB'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/ipad-10-wifi-256gb-guide'
    );
  });

  it('ranks an eSIM guide above a newer physical-SIM sibling guide', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          ...post(
            'iphone-15-physical-sim-guide',
            'Apple iPhone 15 physical SIM Buyer Guide',
            '2026-04-12T09:00:00.000Z'
          ),
          category: 'Smartphones',
          tags: ['smartphones', 'apple'],
        },
        {
          ...post(
            'iphone-15-esim-guide',
            'Apple iPhone 15 eSIM Buyer Guide',
            '2026-04-01T09:00:00.000Z'
          ),
          category: 'Smartphones',
          tags: ['smartphones', 'apple'],
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 e-SIM'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/iphone-15-esim-guide'
    );
  });
});
