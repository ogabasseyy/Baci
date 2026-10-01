import { describe, expect, it } from 'vitest';
import { buildStorefrontProductPurgeUrls } from './storefront-product-purge-urls';

describe('buildStorefrontProductPurgeUrls blog targets', () => {
  it('purges the linked article and social image when a product changes', () => {
    const urls = buildStorefrontProductPurgeUrls(
      ['ogabassey'],
      [{ slug: 'iphone-16', categorySegment: 'smartphones' }],
      ['iphone-guide', 'iphone-guide']
    );

    expect(urls).toContain('https://ogabassey.com/blog');
    expect(urls).toContain('https://ogabassey.com/blog/iphone-guide');
    expect(urls).toContain(
      'https://ogabassey.com/blog/iphone-guide/opengraph-image'
    );
    expect(urls).toContain('https://www.ogabassey.com/blog/iphone-guide');
  });

  it('does not purge blog documents when no linked posts are supplied', () => {
    const urls = buildStorefrontProductPurgeUrls(
      ['ogabassey'],
      [{ slug: 'iphone-16', categorySegment: 'smartphones' }]
    );

    expect(urls.some((url) => url.includes('/blog'))).toBe(false);
  });
});
