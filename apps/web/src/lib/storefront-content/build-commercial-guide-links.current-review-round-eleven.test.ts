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
    tags: [category, 'buyer guide'],
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

describe('buildCommercialGuideLinks current review round eleven', () => {
  it('ranks compact labeled storage for a numeric-model bare-capacity PDP', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 256'],
      },
      [
        post(
          'iphone-15-128gb',
          'Apple iPhone 15 128GB Buyer Guide',
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

  it('matches a 1TB guide to an equivalent bare 1024GB PDP', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Samsung'],
        productNames: ['Samsung Galaxy S25 Ultra 1024'],
      },
      [
        post(
          'galaxy-s25-ultra-512gb',
          'Samsung Galaxy S25 Ultra 512GB Buyer Guide',
          'Smartphones',
          NEWER
        ),
        post(
          'galaxy-s25-ultra-1tb',
          'Samsung Galaxy S25 Ultra 1TB Buyer Guide',
          'Smartphones',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/galaxy-s25-ultra-1tb');
  });

  it('ranks the matching Core Ultra tier above a newer sibling tier', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'laptops',
        brands: ['Dell'],
        productNames: ['Dell XPS 13 9340 Core Ultra 7'],
      },
      [
        post(
          'xps-9340-ultra-5',
          'Dell XPS 13 9340 Core Ultra 5 Buyer Guide',
          'Laptops',
          NEWER
        ),
        post(
          'xps-9340-ultra-7',
          'Dell XPS 13 9340 Core Ultra 7 Buyer Guide',
          'Laptops',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/xps-9340-ultra-7');
  });

  it('ranks the matching RTX comparison above newer sibling tiers', () => {
    const result = firstGuide(
      {
        pageKind: 'compare',
        categorySlug: 'gaming-laptops',
        brands: ['ASUS'],
        productNames: ['ASUS ROG G16 RTX 4060', 'ASUS ROG G16 RTX 4070'],
      },
      [
        post(
          'rog-g16-4070-vs-4080',
          'ASUS ROG G16 RTX 4070 vs ASUS ROG G16 RTX 4080 Comparison',
          'Gaming Laptops',
          NEWER
        ),
        post(
          'rog-g16-4060-vs-4070',
          'ASUS ROG G16 RTX 4060 vs ASUS ROG G16 RTX 4070 Comparison',
          'Gaming Laptops',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/rog-g16-4060-vs-4070');
  });
});
