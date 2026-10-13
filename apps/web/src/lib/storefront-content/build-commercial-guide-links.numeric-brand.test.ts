import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks supplied numeric brands', () => {
  it('matches a numeric model for a brand outside the static alias map', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'nokia-6310-buyer-guide',
          title: 'Nokia 6310 Buyer Guide',
          excerpt: 'What to know before buying the Nokia 6310.',
          category: 'Smartphones',
          tags: ['smartphones', 'nokia'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'nokia-phones-buying-guide',
          title: 'Nokia Phones Buying Guide',
          excerpt: 'How to choose a Nokia phone.',
          category: 'Smartphones',
          tags: ['smartphones', 'nokia'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Nokia'],
        productNames: ['Nokia 6310'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/nokia-6310-buyer-guide',
      'https://ogabassey.com/blog/nokia-phones-buying-guide',
    ]);
  });

  it('uses a retained requested brand token to qualify its model', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'generic-redmi-guide',
          title: 'Redmi Smartphone Buyer Guide',
          excerpt: 'General Redmi buying advice.',
          category: 'Smartphones',
          tags: ['smartphones', 'redmi'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'redmi-15-guide',
          title: 'Redmi 15 Buyer Guide',
          excerpt: 'What to know before buying Redmi 15.',
          category: 'Smartphones',
          tags: ['smartphones', 'redmi'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Redmi'],
        productNames: ['Redmi 15'],
      },
    });

    expect(links[0]?.href).toBe('https://ogabassey.com/blog/redmi-15-guide');
  });
});
