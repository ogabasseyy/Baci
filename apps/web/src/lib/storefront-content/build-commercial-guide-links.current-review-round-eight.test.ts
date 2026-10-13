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
  publishedAt: string
): PublishedClusterPost {
  return {
    slug,
    title,
    excerpt: title,
    category: 'Smartphones',
    tags: ['smartphones', 'buyer guide'],
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

describe('buildCommercialGuideLinks current review round eight', () => {
  it('ranks the matching regional PDP guide above a newer sibling region', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 US'],
      },
      [
        post('iphone-15-uk', 'Apple iPhone 15 UK Buyer Guide', NEWER),
        post('iphone-15-us', 'Apple iPhone 15 US Buyer Guide', OLDER),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/iphone-15-us');
  });

  it('ranks a normalized bare-storage PDP guide above a newer sibling', () => {
    const result = firstGuide(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Samsung'],
        productNames: ['Samsung Galaxy S25 256'],
      },
      [
        post('galaxy-s25-128gb', 'Samsung Galaxy S25 128GB Buyer Guide', NEWER),
        post('galaxy-s25-256gb', 'Samsung Galaxy S25 256GB Buyer Guide', OLDER),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/galaxy-s25-256gb');
  });

  it('ranks an exact regional comparison above a newer sibling comparison', () => {
    const result = firstGuide(
      {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 US', 'Apple iPhone 15 UK'],
      },
      [
        post(
          'iphone-15-uk-vs-global',
          'Apple iPhone 15 UK vs Global Comparison',
          NEWER
        ),
        post(
          'iphone-15-us-vs-uk',
          'Apple iPhone 15 US vs UK Comparison',
          OLDER
        ),
      ]
    );

    expect(result).toBe('https://ogabassey.com/blog/iphone-15-us-vs-uk');
  });
});
