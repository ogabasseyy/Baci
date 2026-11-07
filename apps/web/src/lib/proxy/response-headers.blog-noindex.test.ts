import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { applySecurityHeaders } from './response-headers';

describe('storefront blog query X-Robots-Tag header', () => {
  it.each([
    ['https://ogabassey.com/blog', 'ogabassey.com'],
    ['https://ogabassey.com/blog?page=1', 'ogabassey.com'],
    ['https://ogabassey.com/blog/category/smartphones', 'ogabassey.com'],
    ['https://ogabassey.com/blog/category/smartphones?page=1', 'ogabassey.com'],
    ['https://ogabassey.com/blog/author/ola', 'ogabassey.com'],
    ['https://ogabassey.com/blog/author/ola?page=1', 'ogabassey.com'],
    ['https://ogabassey.com/blog/some-post-slug', 'ogabassey.com'],
    ['https://ogabassey.com/blog/some-post-slug?page=2', 'ogabassey.com'],
    ['https://ogabassey.com/blog/blog?page=2', 'ogabassey.com'],
    ['https://usebaci.com/ogabassey/blog', 'usebaci.com'],
    ['https://usebaci.com/ogabassey/blog/category/smartphones', 'usebaci.com'],
    ['https://usebaci.com/ogabassey/blog/author/ola', 'usebaci.com'],
  ])('does not set X-Robots-Tag on clean or non-listing blog route %s', (fullUrl, hostname) => {
    const url = new URL(fullUrl);
    const response = applySecurityHeaders(
      NextResponse.next(),
      url.pathname,
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest(url),
      hostname
    );

    expect(response.headers.get('X-Robots-Tag')).toBeNull();
  });

  it.each([
    ['https://ogabassey.com/blog?page=2', 'ogabassey.com'],
    ['https://ogabassey.com/blog?search=iphone', 'ogabassey.com'],
    ['https://ogabassey.com/blog?category=Smartphones', 'ogabassey.com'],
    ['https://ogabassey.com/blog?category=Smartphones&page=2', 'ogabassey.com'],
    ['https://ogabassey.com/blog/category/smartphones?page=2', 'ogabassey.com'],
    [
      'https://ogabassey.com/blog/category/smartphones?search=iphone',
      'ogabassey.com',
    ],
    ['https://ogabassey.com/blog/author/ola?page=2', 'ogabassey.com'],
    ['https://usebaci.com/ogabassey/blog?page=2', 'usebaci.com'],
    [
      'https://usebaci.com/ogabassey/blog/category/smartphones?page=2',
      'usebaci.com',
    ],
    ['https://usebaci.com/ogabassey/blog/author/ola?page=2', 'usebaci.com'],
  ])('sets X-Robots-Tag: noindex, follow on %s', (fullUrl, hostname) => {
    const url = new URL(fullUrl);
    const response = applySecurityHeaders(
      NextResponse.next(),
      url.pathname,
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest(url),
      hostname
    );

    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
  });

  it('does not overwrite an existing X-Robots-Tag header', () => {
    const url = new URL('https://ogabassey.com/blog?page=2');
    const response = applySecurityHeaders(
      NextResponse.next({
        headers: {
          'X-Robots-Tag': 'noindex, nofollow',
        },
      }),
      url.pathname,
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest(url),
      'ogabassey.com'
    );

    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});
