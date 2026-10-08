import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchWithCsrf = vi.fn();

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

const originalFetch = global.fetch;

import {
  deleteBlogMediaUpload,
  getPlatformBlogPost,
  listPlatformBlogPosts,
  listPlatformBlogPostsPage,
} from './blog-api';
import { PLATFORM_BLOG_PAGE_SIZE } from './blog-pagination';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('blog-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('lists platform blog posts via GET endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        posts: [
          {
            id: 'post-1',
            slug: 'launch-faster',
            status: 'draft',
            title: 'Launch Faster',
          },
        ],
      })
    );

    const posts = await listPlatformBlogPosts();

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/admin/blog/posts?limit=${PLATFORM_BLOG_PAGE_SIZE}&offset=0`,
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
      })
    );
    expect(posts).toEqual([
      {
        id: 'post-1',
        slug: 'launch-faster',
        status: 'draft',
        title: 'Launch Faster',
      },
    ]);
  });

  it('surfaces JSON error payloads from list endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'boom' }, 500)
    );

    await expect(listPlatformBlogPosts()).rejects.toThrow('boom');
  });

  it('lists platform blog posts with pagination metadata', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        hasMore: true,
        limit: 25,
        offset: 25,
        posts: [
          {
            id: 'post-2',
            slug: 'scale-faster',
            status: 'published',
            title: 'Scale Faster',
          },
        ],
        total: 40,
      })
    );

    const page = await listPlatformBlogPostsPage({ limit: 25, offset: 25 });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/blog/posts?limit=25&offset=25',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
      })
    );
    expect(page).toEqual({
      hasMore: true,
      limit: 25,
      offset: 25,
      posts: [
        {
          id: 'post-2',
          slug: 'scale-faster',
          status: 'published',
          title: 'Scale Faster',
        },
      ],
      total: 40,
    });
  });

  it('normalizes non-finite pagination values before querying', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        hasMore: false,
        limit: PLATFORM_BLOG_PAGE_SIZE,
        offset: 0,
        posts: [],
        total: 0,
      })
    );

    await listPlatformBlogPostsPage({
      limit: Number.NaN,
      offset: Number.POSITIVE_INFINITY,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/admin/blog/posts?limit=${PLATFORM_BLOG_PAGE_SIZE}&offset=0`,
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
      })
    );
  });

  it('loads a single post via GET endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        id: 'post-1',
        slug: 'launch-faster',
        status: 'draft',
        title: 'Launch Faster',
      })
    );

    await expect(getPlatformBlogPost('post-1')).resolves.toEqual(
      expect.objectContaining({ id: 'post-1', slug: 'launch-faster' })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/blog/posts/post-1',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
      })
    );
  });

  it('falls back to default error message when GET error body is not JSON', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response('not-json', { status: 500 })
    );

    await expect(getPlatformBlogPost('post-1')).rejects.toThrow(
      'Failed to load post'
    );
  });

  it('deletes an abandoned upload with its variant paths', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(jsonResponse({ success: true }));

    await deleteBlogMediaUpload('platform/blog/abc123.webp', [
      'platform/blog/abc123/landscape_16x9.webp',
    ]);

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/admin/blog/upload',
      expect.objectContaining({
        body: JSON.stringify({
          path: 'platform/blog/abc123.webp',
          variantPaths: ['platform/blog/abc123/landscape_16x9.webp'],
        }),
        method: 'DELETE',
      })
    );
  });

  it('throws the route error when deleting an abandoned upload fails', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ error: 'Failed to delete file' }, 500)
    );

    await expect(
      deleteBlogMediaUpload('platform/blog/abc123.webp', [])
    ).rejects.toThrow('Failed to delete file');
  });
});
