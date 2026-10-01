import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks game titles', () => {
  it('matches spaced Play Station slugs to branded PlayStation guides', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'best-playstation-5-games',
          title: 'Best PlayStation 5 Games',
          excerpt: 'A current shortlist for console buyers.',
          category: 'PlayStation 5',
          tags: ['playstation', 'ps5', 'games'],
          keywords: ['buying guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'playstation-5-madden-24-guide',
          title: 'PlayStation 5 Madden 24 Buyer Guide',
          excerpt: 'What to know before buying Madden 24.',
          category: 'PlayStation 5',
          tags: ['playstation', 'madden 24'],
          keywords: ['buying guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'playstation-5',
        brands: ['PlayStation'],
        productSlugs: ['play-station-5-madden-24'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/playstation-5-madden-24-guide',
      'https://ogabassey.com/blog/best-playstation-5-games',
    ]);
  });

  it('matches possessive game titles after normalizing apostrophe-s', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'best-ps4-games',
          title: 'Best PS4 Games',
          excerpt: 'A current shortlist for console buyers.',
          category: 'PlayStation 4',
          tags: ['playstation', 'ps4', 'games'],
          keywords: ['buying guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'assassins-creed-odyssey-guide',
          title: "Assassin's Creed Odyssey Buyer Guide",
          excerpt: "What to know before buying Assassin's Creed Odyssey.",
          category: 'PlayStation 4',
          tags: ['playstation', 'assassins creed odyssey'],
          keywords: ['buying guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'playstation-4',
        brands: ['PlayStation'],
        productSlugs: ['ps4-assassin-s-creed-odyssey'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/assassins-creed-odyssey-guide',
      'https://ogabassey.com/blog/best-ps4-games',
    ]);
  });

  it('preserves an ampersand inside the exact game title', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'best-ps5-games',
          title: 'Best PS5 Games Buyer Guide',
          excerpt: 'A current shortlist for console buyers.',
          category: 'PlayStation 5',
          tags: ['playstation', 'ps5', 'games'],
          keywords: ['buying guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'ratchet-clank-rift-apart-guide',
          title: 'Ratchet & Clank: Rift Apart Buyer Guide',
          excerpt: 'What to know before buying Ratchet & Clank.',
          category: 'PlayStation 5',
          tags: ['playstation', 'ratchet and clank'],
          keywords: ['buying guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'playstation-5',
        brands: ['PlayStation'],
        productNames: ['Ratchet & Clank: Rift Apart'],
        productSlugs: ['ps5-ratchet-clank-rift-apart'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/ratchet-clank-rift-apart-guide'
    );
  });

  it('matches a compact game code in the guide title', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'generic-ps5-games-guide',
          title: 'Best PS5 Games Buyer Guide',
          excerpt: 'A current shortlist for console buyers.',
          category: 'PlayStation 5',
          tags: ['playstation', 'ps5', 'games'],
          keywords: ['buying guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'fifa23-ps5-guide',
          title: 'FIFA23 Buyer Guide for PS5',
          excerpt: 'What to know before buying FIFA23.',
          category: 'PlayStation 5',
          tags: ['playstation', 'ps5', 'fifa'],
          keywords: ['buying guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'playstation-5',
        brands: ['PlayStation'],
        productNames: ['PS5 FIFA23'],
      },
    });

    expect(links[0]?.href).toBe('https://ogabassey.com/blog/fifa23-ps5-guide');
  });

  it('binds the platform on broad gaming pages', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'fifa23-xbox-guide',
          title: 'FIFA23 Buyer Guide for Xbox',
          excerpt: 'Xbox edition buying advice.',
          category: 'Gaming',
          tags: ['gaming', 'xbox'],
          keywords: null,
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'fifa23-ps5-guide',
          title: 'FIFA23 Buyer Guide for PS5',
          excerpt: 'PS5 edition buying advice.',
          category: 'Gaming',
          tags: ['gaming', 'ps5'],
          keywords: null,
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'gaming',
        brands: ['PS5'],
        productNames: ['PS5 FIFA23'],
      },
    });

    expect(links[0]?.href).toBe('https://ogabassey.com/blog/fifa23-ps5-guide');
  });
});
