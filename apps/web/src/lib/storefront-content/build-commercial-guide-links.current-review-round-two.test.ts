import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';
import type {
  BuildCommercialGuideLinksContext,
  PublishedClusterPost,
} from './content-cluster-types';

const NEWER = '2026-04-12T09:00:00.000Z';
const OLDER = '2026-04-01T09:00:00.000Z';

function post(
  slug: string,
  title: string,
  category: string,
  publishedAt: string
): PublishedClusterPost {
  return {
    slug,
    title,
    excerpt: title,
    category,
    tags: [category.toLowerCase(), 'buyer guide'],
    keywords: ['buyer guide'],
    featured_image_url: null,
    published_at: publishedAt,
    reading_time_minutes: 6,
  };
}

function firstGuide(
  context: BuildCommercialGuideLinksContext,
  posts: PublishedClusterPost[]
) {
  return buildCommercialGuideLinks({
    storeUrl: 'https://ogabassey.com',
    context,
    posts,
  })[0]?.href;
}

describe('buildCommercialGuideLinks current review round two', () => {
  it('prefers a numeric model supplied by a paired PDP slug', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'laptops',
        brands: ['Dell'],
        productNames: ['Dell XPS'],
        productSlugs: ['dell-xps-13'],
      },
      [
        post('dell-xps-guide', 'Dell XPS Buyer Guide', 'Laptops', NEWER),
        post('dell-xps-13-guide', 'Dell XPS 13 Buyer Guide', 'Laptops', OLDER),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/dell-xps-13-guide');
  });

  it('ranks an exact storage guide above a newer generic model guide', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 256GB'],
      },
      [
        post(
          'iphone-15-guide',
          'Apple iPhone 15 Buyer Guide',
          'Smartphones',
          NEWER
        ),
        post(
          'iphone-15-256gb',
          'Apple iPhone 15 256GB Buyer Guide',
          'Smartphones',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/iphone-15-256gb');
  });

  it('retains both SIM mode and slug-supplied network generation', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Samsung'],
        productNames: ['Samsung A15 Dual SIM'],
        productSlugs: ['samsung-a15-5g-dual-sim'],
      },
      [
        post(
          'a15-4g-dual-sim',
          'Samsung A15 4G Dual SIM Buyer Guide',
          'Smartphones',
          NEWER
        ),
        post(
          'a15-5g-dual-sim',
          'Samsung A15 5G Dual SIM Buyer Guide',
          'Smartphones',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/a15-5g-dual-sim');
  });

  it('preserves the ROG Ally X handheld model suffix', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'portable-gaming',
        brands: ['ASUS'],
        productNames: ['ASUS ROG Ally X'],
      },
      [
        post(
          'rog-ally-guide',
          'ASUS ROG Ally Buyer Guide',
          'Portable Gaming',
          NEWER
        ),
        post(
          'rog-ally-x-guide',
          'ROG Ally X Buyer Guide',
          'Portable Gaming',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/rog-ally-x-guide');
  });
});
