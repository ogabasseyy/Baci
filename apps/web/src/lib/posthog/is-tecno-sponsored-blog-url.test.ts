import { describe, expect, it } from 'vitest';
import { isTecnoSponsoredBlogUrl } from './is-tecno-sponsored-blog-url';

describe('isTecnoSponsoredBlogUrl', () => {
  it('matches the canonical custom-domain URL with or without a trailing slash', () => {
    expect(
      isTecnoSponsoredBlogUrl(
        'https://ogabassey.com/blog/tecno-camon-slim-iphone-instant-transfer-sponsored'
      )
    ).toBe(true);
    expect(
      isTecnoSponsoredBlogUrl(
        'HTTPS://OGABASSEY.COM/blog/tecno-camon-slim-iphone-instant-transfer-sponsored/?utm_source=test'
      )
    ).toBe(true);
  });

  it('rejects subdomains, non-https origins, and other slugs', () => {
    expect(
      isTecnoSponsoredBlogUrl(
        'https://ogabassey.usebaci.com/blog/tecno-camon-slim-iphone-instant-transfer-sponsored'
      )
    ).toBe(false);
    expect(
      isTecnoSponsoredBlogUrl(
        'http://ogabassey.com/blog/tecno-camon-slim-iphone-instant-transfer-sponsored'
      )
    ).toBe(false);
    expect(
      isTecnoSponsoredBlogUrl('https://ogabassey.com/blog/other-post')
    ).toBe(false);
    expect(isTecnoSponsoredBlogUrl('not-a-url')).toBe(false);
  });
});
