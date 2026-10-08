import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistBlogPostMutation } from './persist-blog-post-mutation';

const KEPT_CONTENT =
  '<img src="https://cdn.example.com/media/platform/blog/kept.webp">';

function fakeSupabase(args: {
  current?: Record<string, unknown> | null;
  mutationError?: { code?: string; details?: string; message?: string } | null;
  statuses?: { path: string; status: string }[] | null;
}) {
  const rpcCalls: string[] = [];
  const state = { deleted: 0, updated: [] as Record<string, unknown>[] };
  const query = {
    delete: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    update: vi.fn(),
  };
  query.eq.mockReturnValue(query);
  query.select.mockImplementation((columns: string) => {
    if (columns !== 'id') return query;
    return Promise.resolve({ data: [{ id: 'post-1' }], error: null });
  });
  query.single.mockImplementation(() =>
    Promise.resolve({
      data: args.current === undefined ? null : args.current,
      error: args.current == null ? { message: 'no row' } : null,
    })
  );
  query.update.mockImplementation((value: Record<string, unknown>) => {
    state.updated.push(value);
    return query;
  });
  query.delete.mockImplementation(() => {
    state.deleted += 1;
    return query;
  });
  const rpc = vi.fn((name: string) => {
    rpcCalls.push(name);
    if (name === 'mutate_merchant_blog_post_with_product_links') {
      return Promise.resolve({
        data: args.mutationError
          ? null
          : {
              category: null,
              content: KEPT_CONTENT,
              excerpt: null,
              featured_image_url: null,
              id: 'post-1',
              merchant_id: 'merchant-1',
              published_at: null,
              slug: 'kept',
              status: 'draft',
              title: 'Kept',
            },
        error: args.mutationError ?? null,
      });
    }
    return Promise.resolve({ data: args.statuses ?? null, error: null });
  });
  const supabase = {
    from: (table: string) => {
      if (table !== 'blog_posts') throw new Error(`unexpected ${table}`);
      return query;
    },
    rpc,
  } as unknown as Parameters<typeof persistBlogPostMutation>[0]['supabase'];
  return { rpcCalls, state, supabase };
}

const SAVED_CURRENT = {
  author_image_url: null,
  content: KEPT_CONTENT,
  excerpt: null,
  featured_image_url: null,
  featured_image_variants: null,
  updated_at: 'ts-b',
};

describe('persistBlogPostMutation tombstone handshake', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('persists a create when every saved path registers cleared', async () => {
    const { rpcCalls, supabase } = fakeSupabase({
      statuses: [{ path: 'platform/blog/kept.webp', status: 'cleared' }],
    });

    const result = await persistBlogPostMutation({
      embeddedProductIds: undefined,
      merchantId: 'merchant-1',
      postData: { content: KEPT_CONTENT, slug: 'kept', title: 'Kept' },
      postId: null,
      supabase,
    });

    expect(result.error).toBeNull();
    expect(result.post?.id).toBe('post-1');
    expect(rpcCalls).toContain('register_blog_media_references_v1');
  });

  it('skips registration on a media-free create', async () => {
    const rpc = vi.fn((name: string) =>
      Promise.resolve({
        data:
          name === 'mutate_merchant_blog_post_with_product_links'
            ? {
                content: '<p>No images</p>',
                id: 'post-1',
                merchant_id: 'merchant-1',
                slug: 'plain',
                status: 'draft',
                title: 'Plain',
              }
            : null,
        error: null,
      })
    );
    const supabase = {
      from: () => {
        throw new Error('unexpected table access');
      },
      rpc,
    } as unknown as Parameters<typeof persistBlogPostMutation>[0]['supabase'];

    const result = await persistBlogPostMutation({
      embeddedProductIds: undefined,
      merchantId: 'merchant-1',
      postData: { content: '<p>No images</p>', slug: 'plain', title: 'Plain' },
      postId: null,
      supabase,
    });

    expect(result.error).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('deletes the created row when the sweep claimed its media', async () => {
    const { state, supabase } = fakeSupabase({
      current: { ...SAVED_CURRENT },
      statuses: [{ path: 'platform/blog/kept.webp', status: 'claimed' }],
    });

    const result = await persistBlogPostMutation({
      embeddedProductIds: undefined,
      merchantId: 'merchant-1',
      postData: { content: KEPT_CONTENT, slug: 'kept', title: 'Kept' },
      postId: null,
      supabase,
    });

    expect(result).toEqual({
      error: 'Referenced media was removed during save',
      post: null,
      status: 500,
    });
    expect(state.deleted).toBe(1);
  });

  it('persists an update when every saved path registers cleared', async () => {
    const { supabase } = fakeSupabase({
      statuses: [{ path: 'platform/blog/kept.webp', status: 'cleared' }],
    });

    const result = await persistBlogPostMutation({
      embeddedProductIds: undefined,
      existingPost: { content: '<p>Old</p>' },
      merchantId: 'merchant-1',
      postData: { content: KEPT_CONTENT },
      postId: 'post-1',
      supabase,
    });

    expect(result.error).toBeNull();
    expect(result.post?.id).toBe('post-1');
  });

  it('restores the pre-save media when the sweep claimed an update', async () => {
    const { state, supabase } = fakeSupabase({
      current: { ...SAVED_CURRENT },
      statuses: [{ path: 'platform/blog/kept.webp', status: 'missing' }],
    });

    const result = await persistBlogPostMutation({
      embeddedProductIds: undefined,
      existingPost: { content: '<p>Old</p>' },
      merchantId: 'merchant-1',
      postData: { content: KEPT_CONTENT },
      postId: 'post-1',
      supabase,
    });

    expect(result).toEqual({
      error: 'Referenced media was removed during save',
      post: null,
      status: 500,
    });
    expect(state.updated).toEqual([{ content: '<p>Old</p>' }]);
  });

  it('maps mutation errors without running the handshake', async () => {
    const { rpcCalls, supabase } = fakeSupabase({
      mutationError: {
        code: '23505',
        details: 'Key (merchant_id, slug)=(m, kept) already exists.',
      },
      statuses: [{ path: 'platform/blog/kept.webp', status: 'cleared' }],
    });

    const result = await persistBlogPostMutation({
      embeddedProductIds: undefined,
      merchantId: 'merchant-1',
      postData: { content: KEPT_CONTENT, slug: 'kept', title: 'Kept' },
      postId: null,
      supabase,
    });

    expect(result).toEqual({
      error: 'A post with this slug already exists',
      post: null,
      status: 409,
    });
    expect(rpcCalls).not.toContain('register_blog_media_references_v1');
  });
});
