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

  it('pins the Next.js outside-request error wording used by the standalone VPS edge-purge fallback', async () => {
    const actualNextCache =
      await vi.importActual<typeof import('next/cache')>('next/cache');
    expect(() => actualNextCache.revalidateTag('blog-posts', 'max')).toThrow(
      /static generation store/
    );
  });

  it('sends authenticated chunked internal revalidation requests when VPS_WORKER=1', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VPS_WORKER', '1');
    vi.stubEnv('INTERNAL_API_SECRET', 'internal-secret');
    vi.stubEnv('BACI_WEB_BASE_URL', 'https://app.usebaci.com/ignored-path');

    const posts = Array.from({ length: 251 }, (_, index) =>
      createScheduledPost({
        category: `cat-${index % 55}`,
        id: `post-${index + 1}`,
        slug: `post-slug-${index + 1}`,
      })
    );
    configurePublishFlow(posts);
    mockGetMerchantBlogCacheIdentifiers.mockResolvedValue({
      identifiers: Array.from(
        { length: 25 },
        (_, i) => `store-${i}.example.com`
      ),
      canonicalMerchantSlug: 'test-store',
    });

    try {
      const response = await POST(createCronRequest());
      expect(response.status).toBe(200);
      expect(mockRevalidateBlogPosts).not.toHaveBeenCalled();

      const internalCalls = fetchMock.mock.calls.filter(
        ([url]) =>
          url === 'https://app.usebaci.com/api/internal/revalidate-blog'
      );
      expect(internalCalls).toHaveLength(2);

      const firstBody = JSON.parse(String(internalCalls[0]?.[1]?.body));
      const secondBody = JSON.parse(String(internalCalls[1]?.[1]?.body));
      expect(internalCalls[0]?.[1]?.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer internal-secret',
          'Content-Type': 'application/json',
        })
      );
      expect(firstBody.identifiers).toHaveLength(20);
      expect(firstBody.postSlugs).toHaveLength(250);
      expect(firstBody.listingCategories).toHaveLength(50);
      expect(secondBody.identifiers).toHaveLength(5);
      expect(secondBody.postSlugs).toHaveLength(1);
      expect(secondBody.listingCategories).toHaveLength(5);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects non-HTTPS standalone revalidation origins without calling fetch', async () => {
    const fetchMock = vi.fn();
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VPS_WORKER', '1');
    vi.stubEnv('INTERNAL_API_SECRET', 'internal-secret');
    vi.stubEnv('BACI_WEB_BASE_URL', 'http://insecure.example.com');

    configurePublishFlow([createScheduledPost({ id: 'post-1', slug: 's-1' })]);

    try {
      const response = await POST(createCronRequest());
      const json = await response.json();
      expect(response.status).toBe(500);
      expect(json.failedMerchants).toEqual(['merchant-1']);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
