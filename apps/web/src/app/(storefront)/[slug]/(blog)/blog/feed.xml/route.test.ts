import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHeaders = vi.fn();
const mockResolveStorefrontSitemapContext = vi.fn();
const mockGetMerchantBlogFeed =
  vi.fn<typeof import('@/app/api/blog/feed/[merchantSlug]/route').GET>();

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('../../../sitemap-data', () => ({
  resolveStorefrontSitemapContextResult: (...args: unknown[]) =>
    mockResolveStorefrontSitemapContext(...args),
}));

vi.mock('@/app/api/blog/feed/[merchantSlug]/route', () => ({
  GET: (
    ...args: Parameters<
      typeof import('@/app/api/blog/feed/[merchantSlug]/route').GET
    >
  ) => mockGetMerchantBlogFeed(...args),
}));

import { GET } from './route';

describe('GET /[slug]/blog/feed.xml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.mockResolvedValue(new Headers());
  });

  it('delegates to the merchant RSS feed handler when blog is enabled', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'found',
      context: {
        merchant: {
          slug: 'ogabassey',
          feature_settings: { blog_enabled: true },
        },
        storeUrl: 'https://ogabassey.com',
      },
    });
    mockGetMerchantBlogFeed.mockResolvedValue(
      new NextResponse('<rss />', {
        status: 200,
        headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
      })
    );

    const request = new NextRequest('https://ogabassey.com/blog/feed.xml', {
      headers: {
        cookie: 'session=secret',
        'x-forwarded-for': '203.0.113.10',
      },
    });
    const response = await GET(request, {
      params: Promise.resolve({ slug: 'ogabassey.com' }),
    });

    expect(response.status).toBe(200);
    expect(mockGetMerchantBlogFeed).toHaveBeenCalledWith(
      expect.any(NextRequest),
      {
        params: expect.any(Promise),
      }
    );
    const delegatedRequest = mockGetMerchantBlogFeed.mock.calls[0]?.[0];
    expect(delegatedRequest?.url).toBe('https://ogabassey.com/blog/feed.xml');
    expect(delegatedRequest?.headers.get('cookie')).toBeNull();
    expect(delegatedRequest?.headers.get('x-forwarded-for')).toBeNull();
    const delegatedArgs = mockGetMerchantBlogFeed.mock.calls[0]?.[1];
    expect(delegatedArgs).toBeDefined();
    if (delegatedArgs) {
      await expect(delegatedArgs.params).resolves.toEqual({
        merchantSlug: 'ogabassey',
      });
    }
  });

  it('returns 404 when blog is disabled or merchant context is missing', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'found',
      context: {
        merchant: {
          slug: 'ogabassey',
          feature_settings: { blog_enabled: false },
        },
        storeUrl: 'https://ogabassey.com',
      },
    });

    const response = await GET(
      new NextRequest('https://ogabassey.com/blog/feed.xml'),
      { params: Promise.resolve({ slug: 'ogabassey.com' }) }
    );

    expect(response.status).toBe(404);
    expect(mockGetMerchantBlogFeed).not.toHaveBeenCalled();
  });

  it('returns 503 when merchant lookup is unavailable', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'unavailable',
    });

    const response = await GET(
      new NextRequest('https://ogabassey.com/blog/feed.xml'),
      { params: Promise.resolve({ slug: 'ogabassey.com' }) }
    );

    expect(response.status).toBe(503);
    expect(mockGetMerchantBlogFeed).not.toHaveBeenCalled();
  });

  it('rewrites an existing atom:link rel="self" to the storefront canonical /blog/feed.xml URL', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'found',
      context: {
        merchant: {
          slug: 'ogabassey',
          feature_settings: { blog_enabled: true },
        },
        storeUrl: 'https://ogabassey.com',
      },
    });
    mockGetMerchantBlogFeed.mockResolvedValue(
      new NextResponse(
        '<?xml version="1.0" encoding="utf-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><atom:link href="https://ogabassey.com/api/blog/feed/ogabassey" rel="self" type="application/rss+xml"/><atom:link href="https://ogabassey.com/api/blog/feed/other" rel="self" type="application/rss+xml"/><title>Ogabassey Blog</title></channel></rss>',
        {
          status: 200,
          headers: {
            'content-type': 'application/rss+xml; charset=utf-8',
            'content-length': '250',
            etag: '"upstream-etag"',
            'content-md5': 'abc123==',
          },
        }
      )
    );

    const response = await GET(
      new NextRequest('https://ogabassey.com/blog/feed.xml'),
      { params: Promise.resolve({ slug: 'ogabassey.com' }) }
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(
      body.match(
        /<atom:link href="https:\/\/ogabassey\.com\/blog\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/g
      )
    ).toHaveLength(2);
    expect(body).not.toContain('/api/blog/feed/ogabassey');
    expect(body).not.toContain('/api/blog/feed/other');
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('content-md5')).toBeNull();
    expect(response.headers.get('etag')).toBeNull();
  });

  it('injects xmlns:atom and canonical atom:link self-link when missing from delegated RSS XML', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'found',
      context: {
        merchant: {
          slug: 'ogabassey',
          feature_settings: { blog_enabled: true },
        },
        storeUrl: 'https://ogabassey.com',
      },
    });
    mockGetMerchantBlogFeed.mockResolvedValue(
      new NextResponse(
        '<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>Ogabassey Blog</title></channel></rss>',
        {
          status: 200,
          headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
        }
      )
    );

    const response = await GET(
      new NextRequest('https://ogabassey.com/blog/feed.xml'),
      { params: Promise.resolve({ slug: 'ogabassey.com' }) }
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
    expect(body).toContain(
      '<atom:link href="https://ogabassey.com/blog/feed.xml" rel="self" type="application/rss+xml"/>'
    );
  });

  it('canonicalizes self-link when the upstream <channel> element has attributes or whitespace', async () => {
    mockResolveStorefrontSitemapContext.mockResolvedValue({
      status: 'found',
      context: {
        merchant: {
          slug: 'ogabassey',
          feature_settings: { blog_enabled: true },
        },
        storeUrl: 'https://ogabassey.com',
      },
    });
    mockGetMerchantBlogFeed.mockResolvedValue(
      new NextResponse(
        '<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel xml:lang="en" ><title>Ogabassey Blog</title></channel></rss>',
        {
          status: 200,
          headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
        }
      )
    );

    const response = await GET(
      new NextRequest('https://ogabassey.com/blog/feed.xml'),
      { params: Promise.resolve({ slug: 'ogabassey.com' }) }
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
    expect(body).toContain(
      '<channel xml:lang="en" >\n        <atom:link href="https://ogabassey.com/blog/feed.xml" rel="self" type="application/rss+xml"/>'
    );
  });
});
