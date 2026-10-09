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

function rpcPatch(supabase: { rpcCalls: RpcCall[] }): Record<string, unknown> {
  return supabase.rpcCalls[0]?.args.p_post_data as Record<string, unknown>;
}

describe('updatePlatformBlogPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);

  it('rejects a null JSON body before sanitizing blog fields', async () => {
    const response = await updatePlatformBlogPost(
      new NextRequest('http://localhost/api/admin/blog/posts/post-1', {
        body: 'null',
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('rejects an invalid route parameter before reading a post', async () => {
    const response = await updatePlatformBlogPost(request({ title: 'Title' }), {
      params: Promise.resolve({ id: '' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('rejects an invalid post status before attempting an update', async () => {
    const response = await updatePlatformBlogPost(
      request({ status: 'not-a-status' }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('sends merged media paths to the atomic RPC', async () => {
    const supabase = createSupabase(undefined, {
      content:
        '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/shared.webp">',
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      request({ title: 'Updated title' }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(200);
    expect(supabase.rpcCalls).toHaveLength(1);
    expect(supabase.rpcCalls[0]?.name).toBe('mutate_platform_blog_post_atomic');
    expect(supabase.rpcCalls[0]?.args.p_post_id).toBe('post-1');
    expect(supabase.rpcCalls[0]?.args.p_media_paths).toEqual([
      'platform/blog/shared.webp',
    ]);
    expect(rpcPatch(supabase)).toEqual(
      expect.objectContaining({ title: 'Updated title' })
    );
  });

  it('strips ownership guards and revalidates both changed slugs', async () => {
    const supabase = createSupabase();
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      request({
        is_platform_post: false,
        merchant_id: 'merchant-1',
        slug: 'new-slug',
        title: 'Updated title',
      }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(200);
    expect(rpcPatch(supabase)).toEqual(
      expect.objectContaining({ slug: 'new-slug', title: 'Updated title' })
    );
    expect(rpcPatch(supabase)).not.toHaveProperty('is_platform_post');
    expect(rpcPatch(supabase)).not.toHaveProperty('merchant_id');
    expect(mocks.revalidatePlatformBlog).toHaveBeenNthCalledWith(1, 'old-slug');
    expect(mocks.revalidatePlatformBlog).toHaveBeenNthCalledWith(2, 'new-slug');
  });

  it.each([
    { intent: null },
    { intent: null, intent_source: 'draft_task_type' },
  ])('clears orphan intent_source on direct PATCH: %j', async (body) => {
    const supabase = createSupabase(undefined, {
      intent: 'news',
      intent_source: 'draft_task_type',
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(request(body), {
      params: Promise.resolve({ id: 'post-1' }),
    });

    expect(response.status).toBe(200);
    expect(rpcPatch(supabase)).toEqual(
      expect.objectContaining({ intent: null, intent_source: null })
    );
  });

  it('coerces a source-only update against a NULL-intent row to a clear', async () => {
    const supabase = createSupabase(undefined, {
      intent: null,
      intent_source: null,
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      request({ intent_source: 'sneaky_source' }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(200);
    expect(rpcPatch(supabase)).toEqual(
      expect.objectContaining({ intent_source: null })
    );
    expect(rpcPatch(supabase)).not.toHaveProperty('intent');
  });

  it('keeps a source-only update against a classified intent', async () => {
    const supabase = createSupabase(undefined, {
      intent: 'news',
      intent_source: 'old_source',
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      request({ intent_source: 'new_source' }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(200);
    expect(rpcPatch(supabase)).toEqual(
      expect.objectContaining({ intent_source: 'new_source' })
    );
  });

  it('clears stale alt text when the cover URL changes without new metadata', async () => {
    const supabase = createSupabase(undefined, {
      featured_image_alt: 'Old cover description',
      featured_image_height: 675,
      featured_image_url: 'https://cdn.example.com/old.webp',
      featured_image_variants: {
        landscape_16x9: 'https://cdn.example.com/old-16x9.webp',
      },
      featured_image_width: 1200,
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      request({ featured_image_url: 'https://cdn.example.com/new.webp' }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(200);
    expect(rpcPatch(supabase)).toEqual(
      expect.objectContaining({
        featured_image_alt: null,
        featured_image_height: null,
        featured_image_url: 'https://cdn.example.com/new.webp',
        featured_image_variants: {},
        featured_image_width: null,
      })
    );
  });

  it('maps duplicate slugs to a conflict response', async () => {
    const supabase = createSupabase({ data: null, error: { code: '23505' } });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      request({ slug: 'new-slug', title: 'Updated title' }),
      {
        params: Promise.resolve({ id: 'post-1' }),
      }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'A post with this slug already exists',
    });
  });
});
