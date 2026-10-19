import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePlatformBlog: vi.fn(),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidatePlatformBlog: mocks.revalidatePlatformBlog,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { updatePlatformBlogPost } from './platform-blog-post-update-handler';

type RpcCall = { args: Record<string, unknown>; name: string };

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/blog/posts/post-1', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  });
}

function createSupabase(
  updateResult?: { data: unknown; error: unknown },
  existingPost: Record<string, unknown> = {}
) {
  const rpcCalls: RpcCall[] = [];
  const query = {
    eq: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
    single: vi.fn().mockResolvedValueOnce({
      data: {
        featured_image_height: null,
        featured_image_url: null,
        featured_image_variants: {},
        featured_image_width: null,
        id: 'post-1',
        slug: 'old-slug',
        status: 'draft',
        ...existingPost,
      },
      error: null,
    }),
  };
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.select.mockReturnValue(query);
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ args, name });
    return Promise.resolve(
      updateResult ?? {
        data: [{ id: 'post-1', slug: 'new-slug' }],
        error: null,
      }
    );
  });
  return { from: vi.fn(() => query), rpc, rpcCalls };
}

describe('updatePlatformBlogPost error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);

  it('maps a swept-media abort to the removed-media response', async () => {
    const supabase = createSupabase({
      data: null,
      error: {
        code: 'P0001',
        message:
          'platform_blog_media_swept_during_save: platform/blog/gone.webp',
      },
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      request({ title: 'Updated title' }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Referenced media was removed during save',
    });
  });

  it('maps a missing post to a not-found response', async () => {
    const supabase = createSupabase({
      data: null,
      error: { code: 'P0002', message: 'platform_blog_post_not_found' },
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      request({ title: 'Updated title' }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Post not found',
    });
  });

  it('answers an empty PATCH without calling the RPC', async () => {
    const supabase = createSupabase();
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(request({}), {
      params: Promise.resolve({ id: 'post-1' }),
    });

    expect(response.status).toBe(200);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePlatformBlog).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePlatformBlog).toHaveBeenCalledWith('old-slug');
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ id: 'post-1', slug: 'old-slug' })
    );
  });

  it('rejects clearing published_at on an already published post', async () => {
    const supabase = createSupabase();
    const existingQuery = supabase.from();
    existingQuery.single.mockReset().mockResolvedValueOnce({
      data: {
        featured_image_height: null,
        featured_image_url: null,
        featured_image_variants: {},
        featured_image_width: null,
        id: 'post-1',
        slug: 'published-post',
        status: 'published',
      },
      error: null,
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      request({ published_at: null }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'PUBLISHED_AT_REQUIRED',
      error: 'Published posts must retain a publication timestamp',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
