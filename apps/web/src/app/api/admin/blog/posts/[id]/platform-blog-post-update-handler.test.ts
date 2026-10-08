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
  const updates: Record<string, unknown>[] = [];
  const cleared: string[][] = [];
  const clearIn = vi.fn((_column: string, paths: string[]) => {
    cleared.push(paths);
    return { eq: () => Promise.resolve({ error: null }) };
  });
  const query = {
    delete: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(() => Promise.resolve({ data: [], error: null })),
    is: vi.fn(),
    select: vi.fn(),
    single: vi
      .fn()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce(
        updateResult ?? {
          data: { id: 'post-1', slug: 'new-slug' },
          error: null,
        }
      ),
    update: vi.fn((value: Record<string, unknown>) => {
      updates.push(value);
      return query;
    }),
  };
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.delete.mockReturnValue({ in: clearIn });
  const rpc = vi.fn((_name: string, args: { p_paths: string[] }) =>
    Promise.resolve({
      data: args.p_paths.map((path) => ({ path })),
      error: null,
    })
  );
  return { cleared, from: vi.fn(() => query), rpc, updates };
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

  it('resurrects tombstones referenced by the updated payload', async () => {
    const supabase = createSupabase({
      data: {
        content:
          '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/shared.webp">',
        id: 'post-1',
        slug: 'new-slug',
      },
      error: null,
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      request({ title: 'Updated title' }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith('blog_media_delete_tombstones');
    expect(supabase.cleared).toEqual([['platform/blog/shared.webp']]);
  });

  it('forces platform ownership and revalidates both changed slugs', async () => {
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
    expect(supabase.updates).toEqual([
      expect.objectContaining({
        is_platform_post: true,
        merchant_id: null,
        slug: 'new-slug',
        title: 'Updated title',
      }),
    ]);
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
    expect(supabase.updates).toEqual([
      expect.objectContaining({ intent: null, intent_source: null }),
    ]);
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
    expect(supabase.updates).toEqual([
      expect.objectContaining({ intent_source: null }),
    ]);
    expect(supabase.updates[0]).not.toHaveProperty('intent');
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
    expect(supabase.updates).toEqual([
      expect.objectContaining({ intent_source: 'new_source' }),
    ]);
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
    expect(supabase.updates).toEqual([
      expect.objectContaining({
        featured_image_alt: null,
        featured_image_height: null,
        featured_image_url: 'https://cdn.example.com/new.webp',
        featured_image_variants: {},
        featured_image_width: null,
      }),
    ]);
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
    expect(supabase.updates).toHaveLength(0);
  });
});
