import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PlatformAdminBlogFormState,
  PlatformAdminBlogPostDetail,
} from './blog-types';

const mockFetchWithCsrf = vi.fn();

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

const originalFetch = global.fetch;

import {
  createPlatformBlogPost,
  deletePlatformBlogPost,
  getPlatformBlogPost,
  listPlatformBlogPosts,
  listPlatformBlogPostsPage,
  updatePlatformBlogPost,
} from './blog-api';
import { PLATFORM_BLOG_PAGE_SIZE } from './blog-pagination';

const sampleForm: PlatformAdminBlogFormState = {
  author_name: 'Baci Editorial',
  category: '',
  content: 'Hello world',
  excerpt: '',
  featured_image_alt: 'Hero image alt',
  featured_image_height: 675,
  featured_image_url: 'https://cdn.example.com/platform/blog/source.webp',
  featured_image_variants: {
    landscape_16x9: 'https://cdn.example.com/platform/blog/landscape_16x9.webp',
    square_1x1: 'https://cdn.example.com/platform/blog/square_1x1.webp',
  },
  featured_image_width: 1200,
  seo_description: '',
  seo_title: '',
  slug: '',
  status: 'draft',
  tags: '',
  title: 'Launch Faster',
};

const existingPost: PlatformAdminBlogPostDetail = {
  author_name: sampleForm.author_name,
  category: sampleForm.category || null,
  content: sampleForm.content,
  excerpt: sampleForm.excerpt || null,
  featured_image_alt: sampleForm.featured_image_alt || null,
  featured_image_height: sampleForm.featured_image_height,
  featured_image_url: sampleForm.featured_image_url,
  featured_image_variants: sampleForm.featured_image_variants,
  featured_image_width: sampleForm.featured_image_width,
  id: 'post-1',
  published_at: null,
  seo_description: sampleForm.seo_description || null,
  seo_title: sampleForm.seo_title || null,
  slug: 'launch-faster',
  status: 'draft',
  tags: [],
  title: sampleForm.title,
};

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

  it('creates posts using fetchWithCsrf and includes featured image metadata', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse(
        {
          id: 'post-1',
          slug: 'launch-faster',
          status: 'draft',
          title: 'Launch Faster',
        },
        201
      )
    );

    await createPlatformBlogPost({
      ...sampleForm,
      intent: 'comparison',
      intent_source: 'draft_task_type',
    });

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/admin/blog/posts',
      expect.objectContaining({
        method: 'POST',
      })
    );
    const [, options] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(body.category).toBeUndefined();
    expect(body.excerpt).toBeUndefined();
    expect(body.seo_description).toBeUndefined();
    expect(body.seo_title).toBeUndefined();
    expect(body.slug).toBeUndefined();
    expect(body.featured_image_height).toBe(675);
    expect(body.intent).toBe('comparison');
    expect(body.intent_source).toBe('draft_task_type');
    expect(body.featured_image_width).toBe(1200);
    expect(body.featured_image_variants).toEqual(
      sampleForm.featured_image_variants
    );
  });

  it('resets featured metadata when url changes without new metadata', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ id: 'post-1', slug: 'launch-faster' })
    );

    await updatePlatformBlogPost(
      'post-1',
      {
        ...sampleForm,
        featured_image_url: 'https://cdn.example.com/platform/blog/new.webp',
        category: '',
        excerpt: '',
        featured_image_alt: '',
        seo_description: '',
        seo_title: '',
      },
      existingPost
    );

    const [, options] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(body.category).toBeNull();
    expect(body.excerpt).toBeNull();
    expect(body.featured_image_alt).toBeNull();
    expect(body.seo_description).toBeNull();
    expect(body.seo_title).toBeNull();
    expect(body.featured_image_height).toBeNull();
    expect(body.featured_image_width).toBeNull();
    expect(body.featured_image_variants).toEqual({});
  });

  it('keeps featured metadata when url and metadata change together', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ id: 'post-1', slug: 'launch-faster' })
    );

    await updatePlatformBlogPost(
      'post-1',
      {
        ...sampleForm,
        featured_image_height: 900,
        featured_image_url: 'https://cdn.example.com/platform/blog/new.webp',
        featured_image_variants: {
          landscape_16x9:
            'https://cdn.example.com/platform/blog/new/landscape_16x9.webp',
        },
        featured_image_width: 1600,
      },
      existingPost
    );

    const [, options] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;

    expect(body.featured_image_height).toBe(900);
    expect(body.featured_image_width).toBe(1600);
    expect(body.featured_image_variants).toEqual({
      landscape_16x9:
        'https://cdn.example.com/platform/blog/new/landscape_16x9.webp',
    });
  });

  it('omits featured image metadata when image fields are unchanged', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ id: 'post-1', slug: 'launch-faster' })
    );

    await updatePlatformBlogPost(
      'post-1',
      {
        ...sampleForm,
        category: 'Phones',
        excerpt: 'Updated excerpt',
      },
      existingPost
    );

    const [, options] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;

    expect(Object.hasOwn(body, 'featured_image_url')).toBe(false);
    expect(Object.hasOwn(body, 'featured_image_width')).toBe(false);
    expect(Object.hasOwn(body, 'featured_image_height')).toBe(false);
    expect(Object.hasOwn(body, 'featured_image_variants')).toBe(false);
    expect(body.category).toBe('Phones');
    expect(body.excerpt).toBe('Updated excerpt');
  });

  it('throws API error payloads from update endpoint', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ message: 'update failed' }, 500)
    );

    await expect(updatePlatformBlogPost('post-1', sampleForm)).rejects.toThrow(
      'update failed'
    );
  });

  it('deletes posts using DELETE mutation endpoint', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ success: true }, 200)
    );

    await expect(deletePlatformBlogPost('post-1')).resolves.toBeUndefined();
    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/admin/blog/posts/post-1',
      expect.objectContaining({
        method: 'DELETE',
      })
    );
  });
});
