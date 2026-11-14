import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCronRequest,
  createScheduledPost,
  mockDispatchZohoBlogCampaign,
  mockRevalidateBlogPosts,
  mockSupabase,
  POST,
  resetCronRouteMocks,
} from './route.test-support';

function configureMixedTriggerOutcomes(
  posts: Record<string, unknown>[],
  claimedRows: Array<{ id: string; status?: string | null }>
) {
  mockSupabase.lte
    .mockResolvedValueOnce({ data: posts, error: null })
    .mockReturnValueOnce(mockSupabase);
  mockSupabase.in
    .mockResolvedValueOnce({
      data: posts.map((post) => ({
        merchant_id: post.merchant_id,
        blog_discover_image_validation_enabled: false,
      })),
      error: null,
    })
    .mockResolvedValueOnce({ data: [], error: null })
    .mockImplementationOnce(() => {
      mockSupabase.select.mockResolvedValueOnce({
        data: claimedRows,
        error: null,
      });
      return mockSupabase;
    });
  mockSupabase.select
    .mockReturnValueOnce(mockSupabase)
    .mockReturnValueOnce(mockSupabase)
    .mockReturnValueOnce(mockSupabase);
}

describe('scheduled-post publishing cron errors', () => {
  beforeEach(resetCronRouteMocks);
  afterEach(() => vi.unstubAllEnvs());

  it('stops before publishing when feature settings cannot be loaded', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockSupabase.lte.mockResolvedValue({
      data: [createScheduledPost()],
      error: null,
    });
    mockSupabase.in.mockResolvedValueOnce({
      data: null,
      error: { message: 'feature settings failed' },
    });

    try {
      const response = await POST(createCronRequest());
      await expect(response.json()).resolves.toEqual({
        error: 'Failed to load blog feature settings',
      });
      expect(response.status).toBe(500);
      expect(mockSupabase.update).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('stops before publishing when published blog counts cannot be loaded', async () => {
    mockSupabase.lte.mockResolvedValue({
      data: [createScheduledPost()],
      error: null,
    });
    mockSupabase.in
      .mockResolvedValueOnce({
        data: [{ merchant_id: 'merchant-1' }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'count failed' },
      });

    const response = await POST(createCronRequest());
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to load published blog counts',
    });
    expect(response.status).toBe(500);
    expect(mockSupabase.update).not.toHaveBeenCalled();
    expect(mockRevalidateBlogPosts).not.toHaveBeenCalled();
  });
});

describe('scheduled-post release trigger outcomes', () => {
  beforeEach(resetCronRouteMocks);
  afterEach(() => vi.unstubAllEnvs());

  it('publishes only status=published rows and reports deferred/held rows in skipped', async () => {
    const posts = [
      createScheduledPost({ id: 'post-1', slug: 'slug-1', title: 'Post 1' }),
      createScheduledPost({ id: 'post-2', slug: 'slug-2', title: 'Post 2' }),
      createScheduledPost({ id: 'post-3', slug: 'slug-3', title: 'Post 3' }),
    ];
    configureMixedTriggerOutcomes(posts, [
      { id: 'post-1', status: 'published' },
      { id: 'post-2', status: 'scheduled' },
      { id: 'post-3', status: 'draft' },
    ]);

    const response = await POST(createCronRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      processed: 3,
      published: ['post-1'],
      skipped: [
        {
          id: 'post-2',
          slug: 'slug-2',
          code: 'BLOG_RELEASE_DEFERRED',
          details: {
            status: 'scheduled',
            reason: 'Deferred by database release policy trigger',
          },
        },
        {
          id: 'post-3',
          slug: 'slug-3',
          code: 'BLOG_RELEASE_HELD_EXPIRED_NEWS',
          details: {
            status: 'draft',
            reason:
              'Held as draft because fast-track news expired before publication',
          },
        },
      ],
    });
    expect(mockSupabase.select).toHaveBeenLastCalledWith('id, status');
    expect(mockRevalidateBlogPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        identifiers: ['test-store'],
        listingPages: [1],
        postSlugs: ['slug-1'],
      })
    );
    expect(mockDispatchZohoBlogCampaign).toHaveBeenCalledTimes(1);
    expect(mockDispatchZohoBlogCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        post: expect.objectContaining({ id: 'post-1' }),
      })
    );
  });

  it('skips revalidation and Zoho dispatch when every returned row was deferred', async () => {
    const posts = [
      createScheduledPost({ id: 'post-1', slug: 'slug-1', title: 'Post 1' }),
    ];
    configureMixedTriggerOutcomes(posts, [
      { id: 'post-1', status: 'scheduled' },
    ]);

    const response = await POST(createCronRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      processed: 1,
      published: [],
      skipped: [
        {
          id: 'post-1',
          slug: 'slug-1',
          code: 'BLOG_RELEASE_DEFERRED',
          details: {
            status: 'scheduled',
            reason: 'Deferred by database release policy trigger',
          },
        },
      ],
    });
    expect(mockRevalidateBlogPosts).not.toHaveBeenCalled();
    expect(mockDispatchZohoBlogCampaign).not.toHaveBeenCalled();
  });

  it('treats rows without status property as claimed for backward compatibility', async () => {
    const posts = [
      createScheduledPost({ id: 'post-1', slug: 'slug-1', title: 'Post 1' }),
    ];
    configureMixedTriggerOutcomes(posts, [{ id: 'post-1' }]);

    const response = await POST(createCronRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      processed: 1,
      published: ['post-1'],
      skipped: [],
    });
    expect(mockRevalidateBlogPosts).toHaveBeenCalledTimes(1);
  });

  it('rechecks due published_at during claim update so rescheduled future posts are not claimed or dispatched', async () => {
    const posts = [
      createScheduledPost({
        id: 'post-rescheduled',
        slug: 'rescheduled-post',
        title: 'Rescheduled Post',
      }),
    ];
    configureMixedTriggerOutcomes(posts, []);

    const response = await POST(createCronRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      processed: 1,
      published: [],
      skipped: [],
    });
    expect(mockSupabase.lte).toHaveBeenCalledTimes(2);
    expect(mockSupabase.lte).toHaveBeenLastCalledWith(
      'published_at',
      expect.any(String)
    );
    expect(mockRevalidateBlogPosts).not.toHaveBeenCalled();
    expect(mockDispatchZohoBlogCampaign).not.toHaveBeenCalled();
  });
});
