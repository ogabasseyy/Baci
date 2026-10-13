import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configurePublishFlow,
  createCronRequest,
  createScheduledPost,
  mockDispatchZohoBlogCampaign,
  mockGetMerchantBlogCacheIdentifiers,
  mockRevalidateBlogPosts,
  mockSupabase,
  POST,
  resetCronRouteMocks,
} from './route.test-support';

describe('scheduled-post publishing cron workflow', () => {
  beforeEach(resetCronRouteMocks);
  afterEach(() => vi.unstubAllEnvs());

  it('publishes posts, revalidates each merchant, and uses the configured Zoho dispatcher', async () => {
    const posts = [
      createScheduledPost({
        category: 'reviews',
        id: 'post-1',
        slug: 'apple-studio-display-review',
      }),
      createScheduledPost({
        category: 'laptops',
        id: 'post-2',
        slug: 'macbook-air-m4-review',
      }),
    ];
    configurePublishFlow(posts, {
      publishedPosts: Array.from({ length: 13 }, () => ({
        merchant_id: 'merchant-1',
      })),
    });
    mockGetMerchantBlogCacheIdentifiers.mockResolvedValue({
      identifiers: ['test-store', 'ogabassey.com'],
      canonicalMerchantSlug: 'test-store',
    });
    mockDispatchZohoBlogCampaign.mockImplementation(
      async ({ post }: { post: { id: string } }) => ({
        postId: post.id,
        status: post.id === 'post-2' ? 'failed' : 'skipped',
      })
    );

    const response = await POST(createCronRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockRevalidateBlogPosts).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      identifiers: ['test-store', 'ogabassey.com'],
      canonicalMerchantSlug: 'test-store',
      listingCategories: ['reviews', 'laptops'],
      listingPages: [1, 2],
      postSlugs: ['apple-studio-display-review', 'macbook-air-m4-review'],
    });
    expect(mockDispatchZohoBlogCampaign).toHaveBeenCalledTimes(2);
    expect(mockDispatchZohoBlogCampaign).toHaveBeenCalledWith({
      context: {
        identifiers: ['test-store', 'ogabassey.com'],
        canonicalMerchantSlug: 'test-store',
      },
      post: expect.objectContaining({ id: 'post-1' }),
      supabase: mockSupabase,
    });
    expect(json.zohoCampaigns).toEqual([
      { postId: 'post-1', status: 'skipped' },
      { postId: 'post-2', status: 'failed' },
    ]);
  });

  it('returns 500, but dispatches only merchants with successful revalidation', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    configurePublishFlow([
      createScheduledPost({ id: 'post-1', merchant_id: 'merchant-1' }),
      createScheduledPost({ id: 'post-2', merchant_id: 'merchant-2' }),
    ]);
    mockGetMerchantBlogCacheIdentifiers
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({
        identifiers: ['merchant-two'],
        canonicalMerchantSlug: 'merchant-two',
      });

    try {
      const response = await POST(createCronRequest());
      const json = await response.json();
      expect(response.status).toBe(500);
      expect(json.failedMerchants).toEqual(['merchant-1']);
      expect(mockDispatchZohoBlogCampaign).toHaveBeenCalledTimes(1);
      expect(mockDispatchZohoBlogCampaign).toHaveBeenCalledWith(
        expect.objectContaining({
          post: expect.objectContaining({ id: 'post-2' }),
        })
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('revalidates only rows claimed by a concurrent-safe update', async () => {
    configurePublishFlow(
      [
        createScheduledPost({ id: 'post-1', slug: 'first-post' }),
        createScheduledPost({ id: 'post-2', slug: 'second-post' }),
      ],
      { claimedPostIds: ['post-1'] }
    );

    const response = await POST(createCronRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.published).toEqual(['post-1']);
    expect(mockRevalidateBlogPosts).toHaveBeenCalledWith(
      expect.objectContaining({ postSlugs: ['first-post'] })
    );
    expect(mockDispatchZohoBlogCampaign).toHaveBeenCalledTimes(1);
    expect(mockDispatchZohoBlogCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        post: expect.objectContaining({ id: 'post-1' }),
      })
    );
  });

  it('does not revalidate or dispatch when another run claims every row', async () => {
    configurePublishFlow(
      [createScheduledPost({ id: 'post-1', slug: 'already-claimed' })],
      { claimedPostIds: [] }
    );

    const response = await POST(createCronRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.published).toEqual([]);
    expect(mockRevalidateBlogPosts).not.toHaveBeenCalled();
    expect(mockDispatchZohoBlogCampaign).not.toHaveBeenCalled();
  });
});
