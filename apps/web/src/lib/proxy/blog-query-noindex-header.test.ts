import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { applyBlogQueryNoindexHeader } from './blog-query-noindex-header';

describe('blog-query-noindex-header', () => {
  describe('applyBlogQueryNoindexHeader', () => {
    it('does not set header on clean /blog', () => {
      const response = NextResponse.next();
      const applied = applyBlogQueryNoindexHeader(response, '/blog');
      expect(applied).toBe(false);
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
    });

    it('sets noindex header for /blog?search=iphone', () => {
      const response = NextResponse.next();
      const applied = applyBlogQueryNoindexHeader(
        response,
        '/blog?search=iphone'
      );
      expect(applied).toBe(true);
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    });

    it('sets noindex header for /ogabassey/blog?search=? preserving question marks in query', () => {
      const response = NextResponse.next();
      const applied = applyBlogQueryNoindexHeader(
        response,
        '/ogabassey/blog?search=?'
      );
      expect(applied).toBe(true);
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    });

    it('sets noindex header for /blog?category=reviews', () => {
      const response = NextResponse.next();
      const applied = applyBlogQueryNoindexHeader(
        response,
        '/blog?category=reviews'
      );
      expect(applied).toBe(true);
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    });

    it('sets noindex header for /blog?page=2', () => {
      const response = NextResponse.next();
      const applied = applyBlogQueryNoindexHeader(response, '/blog?page=2');
      expect(applied).toBe(true);
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    });

    it('sets noindex header for /ogabassey/blog/category/reviews?page=2', () => {
      const response = NextResponse.next();
      const applied = applyBlogQueryNoindexHeader(
        response,
        '/ogabassey/blog/category/reviews?page=2'
      );
      expect(applied).toBe(true);
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    });

    it('sets noindex header for /blog/author/john?page=2', () => {
      const response = NextResponse.next();
      const applied = applyBlogQueryNoindexHeader(
        response,
        '/blog/author/john?page=2'
      );
      expect(applied).toBe(true);
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    });

    it.each([
      '/products',
      '/products?page=2',
      '/api/health?check=1',
      '/dashboard/analytics?page=2',
    ])('does not set header on non-blog path %s', (path) => {
      const response = NextResponse.next();
      const applied = applyBlogQueryNoindexHeader(response, path);
      expect(applied).toBe(false);
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
    });

    it('does not overwrite existing X-Robots-Tag', () => {
      const response = NextResponse.next({
        headers: { 'X-Robots-Tag': 'noindex, nofollow' },
      });
      const applied = applyBlogQueryNoindexHeader(response, '/blog?page=2');
      expect(applied).toBe(false);
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('accepts raw Headers object', () => {
      const headers = new Headers();
      const applied = applyBlogQueryNoindexHeader(headers, '/blog?page=2');
      expect(applied).toBe(true);
      expect(headers.get('X-Robots-Tag')).toBe('noindex, follow');
    });

    it('does not set header for non-storefront route types', () => {
      const adminResponse = NextResponse.next();
      expect(
        applyBlogQueryNoindexHeader(
          adminResponse,
          '/blog',
          'ogabassey.com',
          'admin',
          new URLSearchParams('page=2')
        )
      ).toBe(false);
      expect(adminResponse.headers.get('X-Robots-Tag')).toBeNull();

      const apiResponse = NextResponse.next();
      expect(
        applyBlogQueryNoindexHeader(
          apiResponse,
          '/blog',
          'ogabassey.com',
          'api',
          new URLSearchParams('page=2')
        )
      ).toBe(false);
      expect(apiResponse.headers.get('X-Robots-Tag')).toBeNull();
    });

    it('does not set header when searchParams is undefined', () => {
      const response = NextResponse.next();
      expect(
        applyBlogQueryNoindexHeader(
          response,
          '/blog',
          'ogabassey.com',
          'storefront',
          undefined
        )
      ).toBe(false);
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
    });

    it.each([
      ['/blog', ''],
      ['/blog', 'page=1'],
      ['/blog/category/smartphones', ''],
      ['/blog/category/smartphones', 'page=1'],
      ['/blog/some-post-slug', 'page=2'],
    ])('does not set header for clean blog route %s with query "%s"', (pathname, query) => {
      const response = NextResponse.next();
      expect(
        applyBlogQueryNoindexHeader(
          response,
          pathname,
          'ogabassey.com',
          'storefront',
          new URLSearchParams(query)
        )
      ).toBe(false);
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
    });
  });
});
