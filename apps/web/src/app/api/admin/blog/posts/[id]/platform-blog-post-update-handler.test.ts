import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function createSupabase(updateResult?: { data: unknown; error: unknown }) {
  const updates: Record<string, unknown>[] = [];
  const query = {
    eq: vi.fn(),
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
  return { from: vi.fn(() => query), updates };
}

describe('updatePlatformBlogPost', () => {
  beforeEach(() => vi.clearAllMocks());

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
