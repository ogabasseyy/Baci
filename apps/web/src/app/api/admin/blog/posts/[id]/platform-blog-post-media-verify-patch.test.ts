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

function patchSupabase(present: string[], preRead: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const query = {
    eq: vi.fn(),
    in: vi.fn(() => Promise.resolve({ error: null })),
    is: vi.fn(),
    rpc: vi.fn((_name: string, args: { p_paths: string[] }) =>
      Promise.resolve({
        data: args.p_paths
          .filter((path) => present.includes(path))
          .map((path) => ({ path })),
        error: null,
      })
    ),
    select: vi.fn(),
    single: vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          content: '<p>Old</p>',
          id: 'post-1',
          slug: 'old-slug',
          status: 'draft',
          title: 'Old title',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          content:
            '<p>New</p><img src="https://cdn.example.com/media/platform/blog/swept.webp">',
          id: 'post-1',
          slug: 'new-slug',
          updated_at: 'ts-a',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: preRead, error: null }),
    update: vi.fn((value: Record<string, unknown>) => {
      updates.push(value);
      return query;
    }),
  };
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.select.mockImplementation((columns: string) =>
    columns === 'id'
      ? Promise.resolve({ data: [{ id: 'post-1' }], error: null })
      : query
  );
  return { from: vi.fn(() => query), rpc: query.rpc, updates };
}

describe('PATCH media verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a non-media patch without verifying ambient media', async () => {
    // Title-only patch while ambient media is swept: the patch wrote
    // no media, so verification skips and the valid save succeeds
    // instead of 500ing on another tab's breakage.
    const supabase = patchSupabase([], {
      is_platform_post: true,
      merchant_id: null,
      title: 'Updated',
      updated_at: 'ts-a',
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      new NextRequest('http://localhost/api/admin/blog/posts/post-1', {
        body: JSON.stringify({ title: 'Updated' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(200);
    expect(supabase.updates).toHaveLength(1);
    expect(mocks.revalidatePlatformBlog).toHaveBeenCalled();
  });

  it('returns 500 without clobbering an intervening media update', async () => {
    // Content patch whose media was swept, but tab B rewrote the
    // same content after tab A: the media-key guard mismatches, so
    // no restore runs and B's re-verified content stands.
    const sweptSrc =
      'https://cdn.test/storage/v1/object/public/blog-media/platform/blog/swept.webp';
    const supabase = patchSupabase([], {
      content: '<p>Bee</p>',
      is_platform_post: true,
      merchant_id: null,
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      new NextRequest('http://localhost/api/admin/blog/posts/post-1', {
        body: JSON.stringify({ content: `<p><img src="${sweptSrc}"></p>` }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(500);
    expect(supabase.updates).toHaveLength(1);
    expect(mocks.revalidatePlatformBlog).not.toHaveBeenCalled();
  });
});
