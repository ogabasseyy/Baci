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
    content: 'Scheduled body',
    excerpt: null,
    featured_image_height: null,
    featured_image_url: null,
    featured_image_variants: {},
    featured_image_width: null,
    id: 'post-reserved',
    published_at: '2026-11-15T10:00:00.000Z',
    slug: 'reserved-post',
    status: 'scheduled',
    title: 'Reserved Post',
    ...overrides,
  };
}

describe('updateBlogPost release reservation handling', () => {
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

  it('does not trigger publication side effects when database trigger defers a scheduled post', async () => {
    const supabase = createUpdateSupabaseMock();
    mocks.authenticate.mockResolvedValue({ supabase, user: { id: 'user-1' } });
    mocks.loadPost.mockResolvedValue({
      kind: 'found',
      post: makeExistingPost({
        id: 'post-deferred',
        slug: 'deferred-post',
        title: 'Deferred Post',
      }),
    });
    mocks.persistBlogPostMutation.mockResolvedValue({
      error: null,
      post: {
        category: 'guides',
        content: 'Scheduled body',
        excerpt: null,
        id: 'post-deferred',
        published_at: '2026-11-15T10:30:00.000Z',
        slug: 'deferred-post',
        status: 'scheduled',
        title: 'Deferred Post',
      },
      status: null,
    });

    const response = await updateBlogPost(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/post-deferred?merchantId=merchant-1',
        {
          body: JSON.stringify({ status: 'published', title: 'Deferred Post' }),
          method: 'PATCH',
        }
      ),
      { params: Promise.resolve({ id: 'post-deferred' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.scheduleEffects).toHaveBeenCalledWith(
      expect.objectContaining({ publishingNow: false })
    );
  });

  it('routes reserved scheduled post date changes through one atomic reschedule-and-mutate call', async () => {
    const supabase = createUpdateSupabaseMock();
    mocks.authenticate.mockResolvedValue({ supabase, user: { id: 'user-1' } });
    mocks.loadPost.mockResolvedValue({
      kind: 'found',
      post: makeExistingPost(),
    });
    const newSchedule = '2026-11-16T10:00:00.000Z';
    mocks.persistBlogPostMutation
      .mockResolvedValueOnce({
        code: 'scheduled_reservation_requires_reschedule_rpc',
        error: 'Reserved post schedule must be updated via the reschedule RPC',
        post: null,
        status: 409,
      })
      .mockResolvedValueOnce({
        error: null,
        post: {
          category: 'guides',
          content: 'Scheduled body',
          excerpt: null,
          id: 'post-reserved',
          published_at: newSchedule,
          slug: 'reserved-post',
          status: 'scheduled',
          title: 'Updated Reserved Title',
        },
        status: null,
      });

    const response = await updateBlogPost(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/post-reserved?merchantId=merchant-1',
        {
          body: JSON.stringify({
            published_at: newSchedule,
            status: 'scheduled',
            title: 'Updated Reserved Title',
          }),
          method: 'PATCH',
        }
      ),
      { params: Promise.resolve({ id: 'post-reserved' }) }
    );

    expect(response.status).toBe(200);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.persistBlogPostMutation).toHaveBeenCalledTimes(2);
    const secondCall = mocks.persistBlogPostMutation.mock.calls[1]?.[0] as {
      postData: Record<string, unknown>;
      reschedulePublishAt?: string;
    };
    expect(secondCall.reschedulePublishAt).toBe(newSchedule);
    expect(secondCall.postData).not.toHaveProperty('published_at');
    expect(secondCall.postData.title).toBe('Updated Reserved Title');
  });

  it('returns an error without side effects when the atomic reschedule-and-mutate call fails', async () => {
    const supabase = createUpdateSupabaseMock();
    mocks.authenticate.mockResolvedValue({ supabase, user: { id: 'user-1' } });
    mocks.loadPost.mockResolvedValue({
      kind: 'found',
      post: makeExistingPost(),
    });
    const newSchedule = '2026-11-16T10:00:00.000Z';
    mocks.persistBlogPostMutation
      .mockResolvedValueOnce({
        code: 'scheduled_reservation_requires_reschedule_rpc',
        error: 'Reserved post schedule must be updated via the reschedule RPC',
        post: null,
        status: 409,
      })
      .mockResolvedValueOnce({
        error: 'One or more embedded products do not belong to this merchant',
        post: null,
        status: 400,
      });

    const response = await updateBlogPost(
      new NextRequest(
        'http://localhost/api/merchant/blog/posts/post-reserved?merchantId=merchant-1',
        {
          body: JSON.stringify({
            published_at: newSchedule,
            status: 'scheduled',
            title: 'Updated Reserved Title',
          }),
          method: 'PATCH',
        }
      ),
      { params: Promise.resolve({ id: 'post-reserved' }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'One or more embedded products do not belong to this merchant',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.scheduleEffects).not.toHaveBeenCalled();
  });

  it('backfills null published_at when editing a legacy published post in-place', async () => {
    const supabase = createUpdateSupabaseMock();
    mocks.authenticate.mockResolvedValue({ supabase, user: { id: 'user-1' } });
    mocks.loadPost.mockResolvedValue({
      kind: 'found',
      post: makeExistingPost({
        content: 'Legacy body',
        id: 'post-legacy-null',
        published_at: null,
        requested_publish_at: '2026-10-05T09:00:00.000Z',
        slug: 'legacy-null-published',
        status: 'published',
        title: 'Legacy Null Published',
      }),
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
          slug: 'legacy-null-published',
          status: 'published',
          title: 'Legacy Null Published',
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
        published_at: null,
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
});
