import { describe, expect, it } from 'vitest';
import {
  getStorefrontBlogListingRouteKind,
  shouldSetStorefrontBlogQueryNoIndexHeader,
} from './should-set-storefront-blog-query-noindex-header';

describe('getStorefrontBlogListingRouteKind', () => {
  it('returns null for non-storefront route types', () => {
    expect(
      getStorefrontBlogListingRouteKind('/blog', 'ogabassey.com', 'admin')
    ).toBeNull();
    expect(
      getStorefrontBlogListingRouteKind('/blog', 'ogabassey.com', 'api')
    ).toBeNull();
    expect(
      getStorefrontBlogListingRouteKind('/blog', 'ogabassey.com', 'auth')
    ).toBeNull();
  });

  it('classifies root blog listing on custom domain and slug path', () => {
    expect(
      getStorefrontBlogListingRouteKind('/blog', 'ogabassey.com', 'storefront')
    ).toBe('root');
    expect(
      getStorefrontBlogListingRouteKind(
        '/ogabassey/blog',
        undefined,
        'storefront'
      )
    ).toBe('root');
  });

  it('classifies category blog listing', () => {
    expect(
      getStorefrontBlogListingRouteKind(
        '/blog/category/tech',
        'ogabassey.com',
        'storefront'
      )
    ).toBe('category');
    expect(
      getStorefrontBlogListingRouteKind(
        '/ogabassey/blog/category/tech',
        undefined,
        'storefront'
      )
    ).toBe('category');
  });

  it('classifies author blog listing', () => {
    expect(
      getStorefrontBlogListingRouteKind(
        '/blog/author/ola',
        'ogabassey.com',
        'storefront'
      )
    ).toBe('author');
    expect(
      getStorefrontBlogListingRouteKind(
        '/ogabassey/blog/author/ola',
        undefined,
        'storefront'
      )
    ).toBe('author');
  });

  it('returns null for blog post detail pages or unrelated routes', () => {
    expect(
      getStorefrontBlogListingRouteKind(
        '/blog/my-first-post',
        'ogabassey.com',
        'storefront'
      )
    ).toBeNull();
    expect(
      getStorefrontBlogListingRouteKind(
        '/products',
        'ogabassey.com',
        'storefront'
      )
    ).toBeNull();
  });
});

describe('shouldSetStorefrontBlogQueryNoIndexHeader', () => {
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

  it.each([
    ['/blog', ''],
    ['/blog', 'page=1'],
    ['/blog/category/smartphones', ''],
    ['/blog/category/smartphones', 'page=1'],
    ['/blog/author/ola', ''],
    ['/blog/author/ola', 'page=1'],
    ['/blog/some-post-slug', ''],
    ['/blog/some-post-slug', 'page=2'],
    ['/ogabassey/blog', ''],
    ['/ogabassey/blog/category/smartphones', ''],
    ['/ogabassey/blog/author/ola', ''],
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
    ['/ogabassey/blog', 'page=2'],
    ['/ogabassey/blog/category/smartphones', 'page=2'],
    ['/ogabassey/blog/author/ola', 'page=2'],
  ])('returns true for blog listing route %s with query "%s"', (pathname, queryString) => {
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
});
