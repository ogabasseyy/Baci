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
  resolveStorefrontSitemapContext: (...args: unknown[]) =>
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
      merchant: {
        slug: 'ogabassey',
        feature_settings: { blog_enabled: true },
      },
      storeUrl: 'https://ogabassey.com',
    });
    mockGetMerchantBlogFeed.mockResolvedValue(
      new NextResponse('<rss />', {
        status: 200,
        headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
      })
    );

    const request = new NextRequest('https://ogabassey.com/blog/feed.xml');
    const response = await GET(request, {
      params: Promise.resolve({ slug: 'ogabassey.com' }),
    });

    expect(response.status).toBe(200);
    expect(mockGetMerchantBlogFeed).toHaveBeenCalledWith(request, {
      params: expect.any(Promise),
    });
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
      merchant: {
        slug: 'ogabassey',
        feature_settings: { blog_enabled: false },
      },
      storeUrl: 'https://ogabassey.com',
    });

    const response = await GET(
      new NextRequest('https://ogabassey.com/blog/feed.xml'),
      { params: Promise.resolve({ slug: 'ogabassey.com' }) }
    );

    expect(response.status).toBe(404);
    expect(mockGetMerchantBlogFeed).not.toHaveBeenCalled();
  });
});
