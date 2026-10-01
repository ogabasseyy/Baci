import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import {
  blogPostRouteContext,
  blogPostSupabaseMock,
  getBlogPostRouteMocks,
  resetBlogPostRouteMocks,
} from './route.test-helpers';

const blogPostRouteMocks = getBlogPostRouteMocks();
const { PATCH } = await import('./route');

function patchRequest(body?: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/blog/posts/post-1', {
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    method: 'PATCH',
  });
}

describe('PATCH /api/admin/blog/posts/[id]', () => {
  beforeEach(resetBlogPostRouteMocks);

  it('checks auth before csrf on write requests', async () => {
    blogPostRouteMocks.getPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'unauthenticated',
    });

    const response = await PATCH(patchRequest(), blogPostRouteContext());

    expect(response.status).toBe(401);
    expect(blogPostRouteMocks.checkCsrfProtection).not.toHaveBeenCalled();
  });

  it('returns csrf failure response when invalid', async () => {
    blogPostRouteMocks.checkCsrfProtection.mockResolvedValueOnce({
      valid: false,
      response: NextResponse.json({ error: 'CSRF failed' }, { status: 403 }),
    });

    const response = await PATCH(patchRequest(), blogPostRouteContext());

    expect(response.status).toBe(403);
  });

  it('forces platform fields and revalidates after update', async () => {
    const response = await PATCH(
      patchRequest({
        is_platform_post: false,
        merchant_id: 'merchant-1',
        slug: 'launch-faster',
        title: 'Launch Faster',
      }),
      blogPostRouteContext()
    );

    expect(response.status).toBe(200);
    expect(blogPostSupabaseMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_platform_post: true, merchant_id: null })
    );
    expect(blogPostRouteMocks.revalidatePlatformBlog).toHaveBeenCalledWith(
      'launch-faster'
    );
  });

  it('recalculates reading metrics when content changes', async () => {
    blogPostSupabaseMock.single
      .mockResolvedValueOnce({
        data: {
          featured_image_height: null,
          featured_image_url: null,
          featured_image_variants: {},
          featured_image_width: null,
          id: 'post-1',
          slug: 'launch-faster',
          status: 'draft',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'post-1', slug: 'launch-faster', title: 'Launch Faster' },
        error: null,
      });

    const response = await PATCH(
      patchRequest({
        content: 'Updated platform content for fresh reading metrics.',
        title: 'Launch Faster',
      }),
      blogPostRouteContext()
    );

    expect(response.status).toBe(200);
    expect(blogPostSupabaseMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Updated platform content for fresh reading metrics.',
        is_platform_post: true,
        merchant_id: null,
        reading_time_minutes: expect.any(Number),
        word_count: expect.any(Number),
      })
    );
  });

  it('revalidates both old and new slugs when a slug changes', async () => {
    blogPostSupabaseMock.single
      .mockResolvedValueOnce({
        data: {
          featured_image_height: null,
          featured_image_url: null,
          featured_image_variants: {},
          featured_image_width: null,
          id: 'post-1',
          slug: 'old-slug',
          status: 'draft',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'post-1', slug: 'new-slug', title: 'Launch Faster' },
        error: null,
      });

    const response = await PATCH(
      patchRequest({ slug: 'new-slug', title: 'Launch Faster' }),
      blogPostRouteContext()
    );

    expect(response.status).toBe(200);
    expect(blogPostRouteMocks.revalidatePlatformBlog).toHaveBeenNthCalledWith(
      1,
      'old-slug'
    );
    expect(blogPostRouteMocks.revalidatePlatformBlog).toHaveBeenNthCalledWith(
      2,
      'new-slug'
    );
  });

  it('sets published_at when promoting a draft without requiring patch content', async () => {
    blogPostSupabaseMock.single
      .mockResolvedValueOnce({
        data: {
          featured_image_height: 675,
          featured_image_url: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/storage/v1/object/public/media/platform/blog/cover.png`,
          featured_image_variants: {
            landscape_16x9: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/storage/v1/object/public/media/platform/blog/upload-1/landscape_16x9.webp`,
          },
          featured_image_width: 1200,
          id: 'post-1',
          slug: 'launch-faster',
          status: 'draft',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'post-1', slug: 'launch-faster', status: 'published' },
        error: null,
      });

    const response = await PATCH(
      patchRequest({ status: 'published', title: 'Launch Faster' }),
      blogPostRouteContext()
    );

    expect(response.status).toBe(200);
    expect(blogPostSupabaseMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_platform_post: true,
        merchant_id: null,
        published_at: expect.any(String),
        status: 'published',
      })
    );
  });

  it('clears stale image metadata when an image URL changes without variants', async () => {
    blogPostSupabaseMock.single
      .mockResolvedValueOnce({
        data: {
          featured_image_height: 675,
          featured_image_url: 'https://cdn.example.com/old-cover.png',
          featured_image_variants: {
            landscape_16x9: 'https://cdn.example.com/old-landscape.webp',
          },
          featured_image_width: 1200,
          id: 'post-1',
          slug: 'launch-faster',
          status: 'draft',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          featured_image_height: null,
          featured_image_url: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/new-cover.png`,
          featured_image_variants: {},
          featured_image_width: null,
          id: 'post-1',
          slug: 'launch-faster',
          status: 'draft',
        },
        error: null,
      });

    const featuredImageUrl = `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/new-cover.png`;
    const response = await PATCH(
      patchRequest({
        featured_image_url: featuredImageUrl,
        title: 'Launch Faster',
      }),
      blogPostRouteContext()
    );

    expect(response.status).toBe(200);
    expect(blogPostSupabaseMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        featured_image_url: featuredImageUrl,
        featured_image_width: null,
        featured_image_height: null,
        featured_image_variants: {},
        is_platform_post: true,
        merchant_id: null,
      })
    );
  });
});
