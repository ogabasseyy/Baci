import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckCsrfProtection = vi.fn();
const mockGetPlatformBlogListing = vi.fn();
const mockGetPlatformBlogPost = vi.fn();
const mockIncrementPlatformBlogPostViews = vi.fn();

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/platform-blog', () => ({
  PLATFORM_BLOG_CACHE_TAG: 'platform-blog',
  PLATFORM_BLOG_LIST_CACHE_TAG: 'platform-blog-list',
  getPlatformBlogPostCacheTag: (slug: string) => `platform-blog-post-${slug}`,
  getPlatformBlogListing: (...args: unknown[]) =>
    mockGetPlatformBlogListing(...args),
  getPlatformBlogPost: (...args: unknown[]) => mockGetPlatformBlogPost(...args),
  incrementPlatformBlogPostViews: (...args: unknown[]) =>
    mockIncrementPlatformBlogPostViews(...args),
}));

import { GET, POST } from './route';

describe('GET /api/blog/posts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockGetPlatformBlogListing.mockResolvedValue({
      hasMore: false,
      limit: 20,
      page: 1,
      posts: [],
      total: 0,
      totalPages: 1,
    });
    mockGetPlatformBlogPost.mockResolvedValue(null);
    mockIncrementPlatformBlogPostViews.mockResolvedValue(undefined);
  });

  it('uses the shared platform listing helper with safe pagination', async () => {
    mockGetPlatformBlogListing.mockResolvedValueOnce({
      hasMore: true,
      limit: 10,
      page: 3,
      posts: [{ id: 'post-1', slug: 'launch-faster', title: 'Launch Faster' }],
      total: 40,
      totalPages: 4,
    });

    const response = await GET(
      new NextRequest('http://localhost/api/blog/posts?limit=10&offset=20')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, must-revalidate'
    );
    expect(response.headers.get('Vercel-Cache-Tag')).toBe(
      'platform-blog,platform-blog-list'
    );
    expect(mockGetPlatformBlogListing).toHaveBeenCalledWith({
      category: null,
      limit: 10,
      offset: 20,
      tag: null,
    });
    await expect(response.json()).resolves.toEqual({
      hasMore: true,
      limit: 10,
      offset: 20,
      page: 3,
      posts: [{ id: 'post-1', slug: 'launch-faster', title: 'Launch Faster' }],
      total: 40,
      totalPages: 4,
    });
  });

  it('honors non-page-aligned offsets exactly', async () => {
    mockGetPlatformBlogListing.mockResolvedValueOnce({
      hasMore: true,
      limit: 10,
      page: 2,
      posts: [{ id: 'post-15', slug: 'exact-offset', title: 'Exact Offset' }],
      total: 40,
      totalPages: 4,
    });

    const response = await GET(
      new NextRequest('http://localhost/api/blog/posts?limit=10&offset=15')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, must-revalidate'
    );
    expect(response.headers.get('Vercel-Cache-Tag')).toBe(
      'platform-blog,platform-blog-list'
    );
    expect(mockGetPlatformBlogListing).toHaveBeenCalledWith({
      category: null,
      limit: 10,
      offset: 15,
      tag: null,
    });
    await expect(response.json()).resolves.toMatchObject({
      offset: 15,
      page: 2,
      posts: [{ id: 'post-15', slug: 'exact-offset', title: 'Exact Offset' }],
    });
  });

  it('returns a single post when slug is provided', async () => {
    mockGetPlatformBlogPost.mockResolvedValueOnce({
      id: 'post-1',
      slug: 'launch-faster',
      title: 'Launch Faster',
    });

    const response = await GET(
      new NextRequest('http://localhost/api/blog/posts?slug=launch-faster')
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, must-revalidate'
    );
    expect(response.headers.get('Vercel-Cache-Tag')).toBe(
      'platform-blog,platform-blog-post-launch-faster'
    );
    expect(mockGetPlatformBlogPost).toHaveBeenCalledWith('launch-faster');
    expect(mockIncrementPlatformBlogPostViews).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      id: 'post-1',
      slug: 'launch-faster',
      title: 'Launch Faster',
    });
  });

  it('tracks a post view via POST', async () => {
    mockGetPlatformBlogPost.mockResolvedValueOnce({
      id: 'post-2',
      slug: 'view-error',
      title: 'View Error',
    });
    mockIncrementPlatformBlogPostViews.mockResolvedValueOnce(undefined);

    const response = await POST(
      new NextRequest('http://localhost/api/blog/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'view-error' }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockIncrementPlatformBlogPostViews).toHaveBeenCalledWith('post-2');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('returns 403 when POST CSRF validation fails', async () => {
    mockCheckCsrfProtection.mockResolvedValueOnce({
      valid: false,
      response: Response.json({ error: 'Invalid CSRF token' }, { status: 403 }),
    });

    const response = await POST(
      new NextRequest('http://localhost/api/blog/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'launch-faster' }),
      })
    );

    expect(response.status).toBe(403);
    expect(mockIncrementPlatformBlogPostViews).not.toHaveBeenCalled();
  });

  it('returns ok=false when POST trackView increment fails', async () => {
    mockGetPlatformBlogPost.mockResolvedValueOnce({
      id: 'post-2',
      slug: 'view-error',
      title: 'View Error',
    });
    mockIncrementPlatformBlogPostViews.mockRejectedValueOnce(
      new Error('increment failed')
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await POST(
      new NextRequest('http://localhost/api/blog/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'view-error' }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to increment platform blog post views:',
      expect.objectContaining({
        postId: 'post-2',
        error: expect.any(Error),
      })
    );
    consoleSpy.mockRestore();
  });

  it('forwards category and tag filters to the listing helper', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/blog/posts?category=insights&tag=payments&limit=12&offset=24'
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, must-revalidate'
    );
    expect(response.headers.get('Vercel-Cache-Tag')).toBe(
      'platform-blog,platform-blog-list'
    );
    expect(mockGetPlatformBlogListing).toHaveBeenCalledWith({
      category: 'insights',
      limit: 12,
      offset: 24,
      tag: 'payments',
    });
  });

  it('returns 404 for missing slug lookups', async () => {
    mockGetPlatformBlogPost.mockResolvedValueOnce(null);

    const response = await GET(
      new NextRequest('http://localhost/api/blog/posts?slug=missing')
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Post not found' });
  });

  it('returns 500 when platform listing fetch fails', async () => {
    mockGetPlatformBlogListing.mockRejectedValueOnce(new Error('db failed'));

    const response = await GET(
      new NextRequest('http://localhost/api/blog/posts')
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch blog posts',
    });
  });

  it('returns 500 when platform slug fetch fails', async () => {
    mockGetPlatformBlogPost.mockRejectedValueOnce(new Error('db failed'));

    const response = await GET(
      new NextRequest('http://localhost/api/blog/posts?slug=launch-faster')
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch blog posts',
    });
  });
});
