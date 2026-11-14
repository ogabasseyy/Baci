import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  checkCsrf: vi.fn(),
  getRevalidationContext: vi.fn(),
  hasPermission: vi.fn(),
  loadPost: vi.fn(),
  persistBlogPostMutation: vi.fn(),
  resolveAccess: vi.fn(),
  revalidateBlogPosts: vi.fn(),
  scheduleEffects: vi.fn(),
  validateSlug: vi.fn(),
}));

vi.mock('@/app/api/merchant/features/resolve-selected-merchant-access', () => ({
  resolveSelectedMerchantAccess: mocks.resolveAccess,
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticate,
  hasPermission: mocks.hasPermission,
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateBlogPosts: mocks.revalidateBlogPosts,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.checkCsrf }));
vi.mock('@/lib/get-merchant-blog-cache-identifiers', () => ({
  getMerchantBlogRevalidationContext: mocks.getRevalidationContext,
}));
vi.mock('../persist-blog-post-mutation', () => ({
  persistBlogPostMutation: mocks.persistBlogPostMutation,
}));
vi.mock('./load-blog-post-for-update', () => ({
  loadBlogPostForUpdate: mocks.loadPost,
}));
vi.mock('./updated-post-effects', () => ({
  scheduleUpdatedPostEffects: mocks.scheduleEffects,
}));
vi.mock('./validate-updated-blog-post-slug', () => ({
  validateUpdatedBlogPostSlug: mocks.validateSlug,
}));

import { updateBlogPost } from './update-blog-post';

function createUpdateSupabaseMock() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      blog_enabled: true,
      blog_discover_image_validation_enabled: false,
    },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });

  return {
    from: vi.fn().mockReturnValue({ select }),
    functions: {
      invoke: vi.fn().mockResolvedValue({ error: null }),
    },
  };
}

describe('updateBlogPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCsrf.mockResolvedValue({ response: null, valid: true });
    mocks.resolveAccess.mockResolvedValue({
      access: { merchantId: 'merchant-1', role: 'owner' },
      invalidMerchantId: false,
    });
    mocks.hasPermission.mockReturnValue(true);
    mocks.validateSlug.mockResolvedValue('ok');
    mocks.getRevalidationContext.mockResolvedValue({
      canonicalMerchantSlug: 'merchant-one',
      identifiers: ['merchant-one'],
    });
  });

  it('does not disclose or update a post outside the selected merchant', async () => {
    const supabase = { from: vi.fn() };
    mocks.authenticate.mockResolvedValue({ supabase, user: { id: 'user-1' } });
    mocks.loadPost.mockResolvedValue({ kind: 'not-found' });

    const response = await updateBlogPost(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/foreign-post?merchantId=merchant-1',
        { body: JSON.stringify({ title: 'Attempted update' }), method: 'PATCH' }
      ),
      { params: Promise.resolve({ id: 'foreign-post' }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Post not found' });
    expect(mocks.loadPost).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      postId: 'foreign-post',
      supabase,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('preserves existing published_at on in-place edits of already-published posts', async () => {
    const originalPublishedAt = '2026-10-01T10:00:00.000Z';
    const supabase = createUpdateSupabaseMock();
    mocks.authenticate.mockResolvedValue({ supabase, user: { id: 'user-1' } });
    mocks.loadPost.mockResolvedValue({
      kind: 'found',
      post: {
        author_image_url: null,
        category: 'guides',
        content: 'Old body',
        excerpt: 'Old excerpt',
        featured_image_height: null,
        featured_image_url: null,
        featured_image_variants: {},
        featured_image_width: null,
        id: 'post-1',
        published_at: originalPublishedAt,
        slug: 'published-post',
        status: 'published',
        title: 'Published Post',
      },
    });
    mocks.persistBlogPostMutation.mockImplementation(
      async ({ postData }: { postData: Record<string, unknown> }) => ({
        post: {
          category: 'guides',
          content: 'Updated body',
          excerpt: 'Old excerpt',
          id: 'post-1',
          published_at: postData.published_at,
          slug: 'published-post',
          status: 'published',
          title: 'Updated Title',
        },
      })
    );

    const response = await updateBlogPost(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/post-1?merchantId=merchant-1',
        {
          body: JSON.stringify({
            title: 'Updated Title',
            content: 'Updated body',
            status: 'published',
            published_at: '2026-11-14T12:00:00.000Z',
          }),
          method: 'PATCH',
        }
      ),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.persistBlogPostMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        postId: 'post-1',
        postData: expect.objectContaining({
          published_at: originalPublishedAt,
        }),
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      id: 'post-1',
      published_at: originalPublishedAt,
    });
  });

  it('sets published_at when transitioning a draft post to published without published_at', async () => {
    const supabase = createUpdateSupabaseMock();
    mocks.authenticate.mockResolvedValue({ supabase, user: { id: 'user-1' } });
    mocks.loadPost.mockResolvedValue({
      kind: 'found',
      post: {
        author_image_url: null,
        category: 'guides',
        content: 'Draft body',
        excerpt: null,
        featured_image_height: null,
        featured_image_url: null,
        featured_image_variants: {},
        featured_image_width: null,
        id: 'post-2',
        published_at: null,
        slug: 'draft-post',
        status: 'draft',
        title: 'Draft Post',
      },
    });
    mocks.persistBlogPostMutation.mockImplementation(
      async ({ postData }: { postData: Record<string, unknown> }) => ({
        post: {
          category: 'guides',
          content: 'Draft body',
          excerpt: null,
          id: 'post-2',
          published_at: postData.published_at,
          slug: 'draft-post',
          status: 'published',
          title: 'Draft Post',
        },
      })
    );

    const response = await updateBlogPost(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/post-2?merchantId=merchant-1',
        {
          body: JSON.stringify({
            title: 'Draft Post',
            status: 'published',
          }),
          method: 'PATCH',
        }
      ),
      { params: Promise.resolve({ id: 'post-2' }) }
    );

    expect(response.status).toBe(200);
    const callArg = mocks.persistBlogPostMutation.mock.calls[0]?.[0] as {
      postData: Record<string, unknown>;
    };
    expect(typeof callArg.postData.published_at).toBe('string');
    expect(
      Number.isNaN(Date.parse(String(callArg.postData.published_at)))
    ).toBe(false);
  });
});
