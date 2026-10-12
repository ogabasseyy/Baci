import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistBlogPostMutation } from './persist-blog-post-mutation';

const KEPT_CONTENT =
  '<img src="https://cdn.example.com/media/platform/blog/kept.webp">';

type MutationError = {
  code?: string;
  details?: string;
  message?: string;
} | null;

function fakeSupabase(mutationError?: MutationError) {
  const rpc = vi.fn((name: string, _args?: Record<string, unknown>) => {
    if (name !== 'mutate_merchant_blog_post_with_product_links') {
      throw new Error(`unexpected rpc ${name}`);
    }
    return Promise.resolve({
      data: mutationError
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
      error: mutationError ?? null,
    });
  });
  const supabase = {
    from: () => {
      throw new Error('unexpected table access');
    },
    rpc,
  } as unknown as Parameters<typeof persistBlogPostMutation>[0]['supabase'];
  return { rpc, supabase };
}

describe('persistBlogPostMutation atomic media verify', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes saved media paths to the atomic mutation', async () => {
    const { rpc, supabase } = fakeSupabase();

    const result = await persistBlogPostMutation({
      embeddedProductIds: undefined,
      merchantId: 'merchant-1',
      postData: { content: KEPT_CONTENT, slug: 'kept', title: 'Kept' },
      postId: null,
      supabase,
    });

    expect(result.error).toBeNull();
    expect(result.post?.id).toBe('post-1');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_media_paths: ['platform/blog/kept.webp'],
    });
  });

  it('passes an empty path list on a media-free create', async () => {
    const { rpc, supabase } = fakeSupabase();

    const result = await persistBlogPostMutation({
      embeddedProductIds: undefined,
      merchantId: 'merchant-1',
      postData: { content: '<p>No images</p>', slug: 'plain', title: 'Plain' },
      postId: null,
      supabase,
    });

    expect(result.error).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_media_paths: [] });
  });

  it('maps the atomic swept-media abort to a loud 500', async () => {
    const { rpc, supabase } = fakeSupabase({
      code: 'P0001',
      message: 'merchant_blog_media_swept_during_save: platform/blog/x.webp',
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
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('maps slug conflicts without extra calls', async () => {
    const { rpc, supabase } = fakeSupabase({
      code: '23505',
      details: 'Key (merchant_id, slug)=(m, kept) already exists.',
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
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
