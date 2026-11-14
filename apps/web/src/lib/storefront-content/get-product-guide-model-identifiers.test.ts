import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';
import { getProductGuideModelIdentifiers } from './get-product-guide-model-identifiers';

describe('getProductGuideModelIdentifiers', () => {
  it('adds the numeric XPS family proven by the catalog product name', () => {
    const identifiers = getProductGuideModelIdentifiers({
      pageKind: 'product',
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['Dell XPS 13 9340 Intel Core Ultra 7 32GB'],
    });

    expect(identifiers).toEqual(['xps 9340', 'xps 13 9340']);
  });

  it('does not invent a sibling numeric family absent from the catalog source', () => {
    const identifiers = getProductGuideModelIdentifiers({
      pageKind: 'product',
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['Dell XPS 13 9340 Intel Core Ultra 7 32GB'],
    });

    expect(identifiers).not.toContain('xps 14 9340');
  });

  it('proves a numeric laptop family from an aligned product slug', () => {
    const identifiers = getProductGuideModelIdentifiers({
      pageKind: 'product',
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['Dell XPS'],
      productSlugs: ['dell-xps-13-9340'],
    });

    expect(identifiers).toContain('xps 13 9340');
  });

  it('adds TUF full phrase without exposing bare model code for ASUS TUF gaming laptop', () => {
    const identifiers = getProductGuideModelIdentifiers({
      pageKind: 'product',
      categorySlug: 'gaming-laptops',
      brands: ['ASUS'],
      productSlugs: ['asus-tuf-gaming-f15'],
    });

    expect(identifiers).toContain('tuf f15');
    expect(identifiers).toContain('tuf gaming f15');
    expect(identifiers).not.toContain('f15');

    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'general-gaming-laptop-guide',
          title: 'Best Gaming Laptops in Nigeria',
          excerpt: 'General gaming laptop picks.',
          category: 'Gaming Laptops',
          tags: ['gaming laptops', 'asus'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'asus-tuf-gaming-f15-buyer-guide',
          title: 'ASUS TUF Gaming F15 Buyer Guide',
          excerpt: 'RTX 4060 thermals and display review.',
          category: 'Gaming Laptops',
          tags: ['gaming laptops', 'asus', 'tuf f15'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'gaming-laptops',
        brands: ['ASUS'],
        productSlugs: ['asus-tuf-gaming-f15'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/asus-tuf-gaming-f15-buyer-guide'
    );
  });
});
