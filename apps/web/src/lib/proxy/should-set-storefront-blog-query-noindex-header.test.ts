import { describe, expect, it } from 'vitest';
import { shouldSetStorefrontBlogQueryNoIndexHeader } from './should-set-storefront-blog-query-noindex-header';

describe('shouldSetStorefrontBlogQueryNoIndexHeader', () => {
  it('returns false for non-storefront route types', () => {
    const searchParams = new URLSearchParams('page=2');
    expect(
      shouldSetStorefrontBlogQueryNoIndexHeader(
        '/blog',
        'ogabassey.com',
        'admin',
        searchParams
      )
    ).toBe(false);
    expect(
      shouldSetStorefrontBlogQueryNoIndexHeader(
        '/blog',
        'ogabassey.com',
        'api',
        searchParams
      )
    ).toBe(false);
    expect(
      shouldSetStorefrontBlogQueryNoIndexHeader(
        '/blog',
        'ogabassey.com',
        'auth',
        searchParams
      )
    ).toBe(false);
  });

  it('returns false when searchParams is undefined', () => {
    expect(
      shouldSetStorefrontBlogQueryNoIndexHeader(
        '/blog',
        'ogabassey.com',
        'storefront',
        undefined
      )
    ).toBe(false);
  });

  it('does not misclassify blog detail URLs as root listing on custom domains', () => {
    const searchParams = new URLSearchParams('page=2');
    expect(
      shouldSetStorefrontBlogQueryNoIndexHeader(
        '/blog/blog',
        'ogabassey.com',
        'storefront',
        searchParams
      )
    ).toBe(false);
    expect(
      shouldSetStorefrontBlogQueryNoIndexHeader(
        '/ogabassey/blog',
        undefined,
        'storefront',
        searchParams
      )
    ).toBe(true);
    expect(
      shouldSetStorefrontBlogQueryNoIndexHeader(
        '/ogabassey/blog',
        'usebaci.com',
        'storefront',
        searchParams
      )
    ).toBe(true);
  });

  it.each([
    ['/blog', ''],
    ['/blog', 'page=1'],
    ['/blog/category/smartphones', ''],
    ['/blog/category/smartphones', 'page=1'],
    ['/blog/author/ola', ''],
    ['/blog/author/ola', 'page=1'],
    ['/blog/some-post-slug', ''],
    ['/blog/some-post-slug', 'page=2'],
    ['/products', 'page=2'],
  ])('returns false for clean or non-listing blog route %s with query "%s"', (pathname, queryString) => {
    const searchParams = new URLSearchParams(queryString);
    expect(
      shouldSetStorefrontBlogQueryNoIndexHeader(
        pathname,
        'ogabassey.com',
        'storefront',
        searchParams
      )
    ).toBe(false);
  });

  it.each([
    ['/blog', 'page=2'],
    ['/blog', 'search=iphone'],
    ['/blog', 'category=Smartphones'],
    ['/blog', 'category=Smartphones&page=2'],
    ['/blog/category/smartphones', 'page=2'],
    ['/blog/category/smartphones', 'search=iphone'],
    ['/blog/author/ola', 'page=2'],
  ])('returns true for custom-domain blog listing route %s with query "%s"', (pathname, queryString) => {
    const searchParams = new URLSearchParams(queryString);
    expect(
      shouldSetStorefrontBlogQueryNoIndexHeader(
        pathname,
        'ogabassey.com',
        'storefront',
        searchParams
      )
    ).toBe(true);
  });

  it.each([
    ['/ogabassey/blog', 'page=2'],
    ['/ogabassey/blog/category/smartphones', 'page=2'],
    ['/ogabassey/blog/author/ola', 'page=2'],
  ])('returns true for slug-prefixed blog listing route %s with query "%s"', (pathname, queryString) => {
    const searchParams = new URLSearchParams(queryString);
    expect(
      shouldSetStorefrontBlogQueryNoIndexHeader(
        pathname,
        'usebaci.com',
        'storefront',
        searchParams
      )
    ).toBe(true);
    expect(
      shouldSetStorefrontBlogQueryNoIndexHeader(
        pathname,
        undefined,
        'storefront',
        searchParams
      )
    ).toBe(true);
  });
});
