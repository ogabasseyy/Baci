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
    functions: { invoke: vi.fn().mockResolvedValue({ error: null }) },
    rpc: vi.fn(),
  };
}

function makeExistingPost(overrides: Record<string, unknown> = {}) {
  return {
    author_image_url: null,
    category: 'guides',
    content: 'Legacy body',
    excerpt: null,
    featured_image_height: null,
    featured_image_url: null,
    featured_image_variants: {},
    featured_image_width: null,
    id: 'post-1',
    published_at: null,
    requested_publish_at: '2026-10-05T09:00:00.000Z',
    slug: 'legacy-post',
    status: 'published',
    title: 'Legacy Post',
    ...overrides,
  };
}

describe('updateBlogPost scheduled and legacy timestamp guards', () => {
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

  it('backfills null published_at when editing a legacy published post in-place', async () => {
    const supabase = createUpdateSupabaseMock();
    mocks.authenticate.mockResolvedValue({ supabase, user: { id: 'user-1' } });
    mocks.loadPost.mockResolvedValue({
      kind: 'found',
      post: makeExistingPost({ id: 'post-legacy-null' }),
    });
    mocks.persistBlogPostMutation.mockImplementation(
      async ({ postData }: { postData: Record<string, unknown> }) => ({
        error: null,
        post: {
          category: 'guides',
          content: 'Legacy body',
          excerpt: null,
          id: 'post-legacy-null',
          published_at: postData.published_at,
          slug: 'legacy-post',
          status: 'published',
          title: 'Legacy Post',
        },
        status: null,
      })
    );

    const response = await updateBlogPost(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/post-legacy-null?merchantId=merchant-1',
        {
          body: JSON.stringify({
            status: 'published',
            title: 'Legacy Null Published Updated',
          }),
          method: 'PATCH',
        }
      ),
      { params: Promise.resolve({ id: 'post-legacy-null' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.persistBlogPostMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        postData: expect.objectContaining({
          published_at: '2026-10-05T09:00:00.000Z',
        }),
      })
    );
  });

  it('rejects scheduling a draft without a published_at timestamp', async () => {
    const supabase = createUpdateSupabaseMock();
    mocks.authenticate.mockResolvedValue({ supabase, user: { id: 'user-1' } });
    mocks.loadPost.mockResolvedValue({
      kind: 'found',
      post: makeExistingPost({
        id: 'post-draft-sched',
        requested_publish_at: null,
        status: 'draft',
      }),
    });

    const response = await updateBlogPost(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/post-draft-sched?merchantId=merchant-1',
        { body: JSON.stringify({ status: 'scheduled' }), method: 'PATCH' }
      ),
      { params: Promise.resolve({ id: 'post-draft-sched' }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.persistBlogPostMutation).not.toHaveBeenCalled();
  });

  it('backfills published_at from requested_publish_at when editing a scheduled post with null published_at', async () => {
    const supabase = createUpdateSupabaseMock();
    mocks.authenticate.mockResolvedValue({ supabase, user: { id: 'user-1' } });
    mocks.loadPost.mockResolvedValue({
      kind: 'found',
      post: makeExistingPost({
        id: 'post-sched-req-only',
        published_at: null,
        requested_publish_at: '2026-11-16T10:00:00.000Z',
        status: 'scheduled',
      }),
    });
    mocks.persistBlogPostMutation.mockResolvedValue({
      error: null,
      post: {
        category: 'guides',
        content: 'Scheduled body',
        excerpt: null,
        id: 'post-sched-req-only',
        published_at: '2026-11-16T10:00:00.000Z',
        slug: 'legacy-post',
        status: 'scheduled',
        title: 'Updated Scheduled Title',
      },
      status: null,
    });

    const response = await updateBlogPost(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/post-sched-req-only?merchantId=merchant-1',
        {
          body: JSON.stringify({
            status: 'scheduled',
            title: 'Updated Scheduled Title',
          }),
          method: 'PATCH',
        }
      ),
      { params: Promise.resolve({ id: 'post-sched-req-only' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.persistBlogPostMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        postData: expect.objectContaining({
          published_at: '2026-11-16T10:00:00.000Z',
        }),
      })
    );
  });
});
