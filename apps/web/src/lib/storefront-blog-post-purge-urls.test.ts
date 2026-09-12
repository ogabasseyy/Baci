import { describe, expect, it } from 'vitest';
import { buildStorefrontBlogPostPurgeUrls } from './storefront-blog-post-purge-urls';

describe('buildStorefrontBlogPostPurgeUrls', () => {
  it('builds only related article and social-image URLs for a public storefront', () => {
    const urls = buildStorefrontBlogPostPurgeUrls(
      ['ogabassey'],
      ['Guide-A', 'guide-a', ' guide-b ']
    );

    expect(urls).toEqual([
      'https://ogabassey.com/blog',
      'https://ogabassey.com/blog/Guide-A',
      'https://ogabassey.com/blog/Guide-A/opengraph-image',
      'https://ogabassey.com/blog/guide-a',
      'https://ogabassey.com/blog/guide-a/opengraph-image',
      'https://ogabassey.com/blog/guide-b',
      'https://ogabassey.com/blog/guide-b/opengraph-image',
      'https://www.ogabassey.com/blog',
      'https://www.ogabassey.com/blog/Guide-A',
      'https://www.ogabassey.com/blog/Guide-A/opengraph-image',
      'https://www.ogabassey.com/blog/guide-a',
      'https://www.ogabassey.com/blog/guide-a/opengraph-image',
      'https://www.ogabassey.com/blog/guide-b',
      'https://www.ogabassey.com/blog/guide-b/opengraph-image',
    ]);
    expect(urls).not.toContain('https://ogabassey.com/products');
  });

  it('returns no targets for empty or unknown storefront inputs', () => {
    expect(buildStorefrontBlogPostPurgeUrls(['ogabassey'], [])).toEqual([]);
    expect(
      buildStorefrontBlogPostPurgeUrls(['unknown-store'], ['guide'])
    ).toEqual([]);
  });
});
