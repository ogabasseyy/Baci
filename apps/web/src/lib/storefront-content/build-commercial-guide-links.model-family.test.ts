import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks model-family context', () => {
  it('boosts a family guide above a newer generic brand guide', () => {
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
          slug: 'samsung-galaxy-s-buyer-guide',
          title: 'Samsung Galaxy S Buyer Guide',
          excerpt: 'Galaxy S camera, battery, and performance expectations.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'galaxy s'],
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
        modelFamilySlug: 'galaxy-s',
        productSlugs: [
          'samsung-galaxy-s24',
          'samsung-galaxy-s25',
          'samsung-galaxy-s26',
        ],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/samsung-galaxy-s-buyer-guide',
      'https://ogabassey.com/blog/samsung-buyer-guide',
    ]);
  });

  it('does not boost a generic Redmi guide for the Redmi A family', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'redmi-buyer-guide',
          title: 'Redmi Phones Buyer Guide',
          excerpt: 'How to choose a Redmi phone.',
          category: 'Smartphones',
          tags: ['smartphones', 'redmi'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'redmi-a-buyer-guide',
          title: 'Redmi A Buyer Guide',
          excerpt: 'Redmi A battery and performance expectations.',
          category: 'Smartphones',
          tags: ['smartphones', 'redmi a'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'category',
        categorySlug: 'smartphones',
        brands: ['Xiaomi and Redmi', 'xiaomi'],
        modelFamilySlug: 'redmi-a',
        productSlugs: ['redmi-a5'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/redmi-a-buyer-guide',
      'https://ogabassey.com/blog/redmi-buyer-guide',
    ]);
  });

  it('requires brand context for a common-word Infinix family', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'infinix-buyer-guide',
          title: 'Infinix Phones Buyer Guide',
          excerpt: 'Note the battery life before you buy.',
          category: 'Smartphones',
          tags: ['smartphones', 'infinix'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'infinix-note-buyer-guide',
          title: 'Infinix Note Buyer Guide',
          excerpt: 'Infinix Note battery and performance expectations.',
          category: 'Smartphones',
          tags: ['smartphones', 'infinix note'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'category',
        categorySlug: 'smartphones',
        brands: ['Infinix'],
        modelFamilySlug: 'note',
        productSlugs: ['infinix-note-50'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/infinix-note-buyer-guide',
      'https://ogabassey.com/blog/infinix-buyer-guide',
    ]);
  });

  it('requires a contiguous phrase for a multi-token Redmi family', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'redmi-buyer-guide',
          title: 'Redmi Phones Buyer Guide',
          excerpt: 'Note the battery life before you buy.',
          category: 'Smartphones',
          tags: ['smartphones', 'redmi'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'redmi-note-buyer-guide',
          title: 'Redmi Note Buyer Guide',
          excerpt: 'Redmi Note battery and performance expectations.',
          category: 'Smartphones',
          tags: ['smartphones', 'redmi note'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'category',
        categorySlug: 'smartphones',
        brands: ['Xiaomi and Redmi', 'xiaomi'],
        modelFamilySlug: 'redmi-note',
        productSlugs: ['redmi-note-14'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/redmi-note-buyer-guide',
      'https://ogabassey.com/blog/redmi-buyer-guide',
    ]);
  });

  it('does not boost a cross-brand Galaxy A guide for Oppo A Series', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'oppo-a-series',
          title: 'A Series Buyer Guide',
          excerpt: 'Oppo A Series battery and performance expectations.',
          category: 'Smartphones',
          tags: ['smartphones', 'oppo', 'a series'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'samsung-galaxy-a-series',
          title: 'Samsung Galaxy A Series Buyer Guide',
          excerpt: 'Galaxy A battery and performance expectations.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'galaxy a series'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'category',
        categorySlug: 'smartphones',
        brands: ['Oppo'],
        modelFamilySlug: 'a-series',
        productSlugs: ['oppo-a5'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/oppo-a-series',
      'https://ogabassey.com/blog/samsung-galaxy-a-series',
    ]);
  });

  it('does not bind an A Series phrase to Oppo in a mixed-brand comparison', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'oppo-a-series',
          title: 'Oppo A Series Buyer Guide',
          excerpt: 'Oppo A Series battery and performance expectations.',
          category: 'Smartphones',
          tags: ['smartphones', 'oppo', 'a series'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'samsung-a-series-vs-oppo-reno',
          title: 'Samsung Galaxy A Series vs Oppo Reno Buyer Guide',
          excerpt: 'Compare Samsung Galaxy A Series and Oppo Reno phones.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'oppo'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'category',
        categorySlug: 'smartphones',
        brands: ['Oppo'],
        modelFamilySlug: 'a-series',
        productSlugs: ['oppo-a5'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/oppo-a-series',
      'https://ogabassey.com/blog/samsung-a-series-vs-oppo-reno',
    ]);
  });
});
