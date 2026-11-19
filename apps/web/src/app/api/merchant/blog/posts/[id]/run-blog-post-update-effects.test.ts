import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetBlogEmbeddingText,
  mockGetMerchantBlogRevalidationContext,
  mockRevalidateBlogPosts,
  mockScheduleUpdatedPostEffects,
} = vi.hoisted(() => ({
  mockGetBlogEmbeddingText: vi.fn(),
  mockGetMerchantBlogRevalidationContext: vi.fn(),
  mockRevalidateBlogPosts: vi.fn(),
  mockScheduleUpdatedPostEffects: vi.fn(),
}));

vi.mock('@/lib/embeddings', () => ({
  getBlogEmbeddingText: mockGetBlogEmbeddingText,
}));

vi.mock('@/lib/get-merchant-blog-cache-identifiers', () => ({
  getMerchantBlogRevalidationContext: mockGetMerchantBlogRevalidationContext,
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateBlogPosts: mockRevalidateBlogPosts,
}));

vi.mock('./updated-post-effects', () => ({
  scheduleUpdatedPostEffects: mockScheduleUpdatedPostEffects,
}));

import { runBlogPostUpdateEffects } from './run-blog-post-update-effects';

describe('runBlogPostUpdateEffects', () => {
  const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  const basePost = {
    category: 'Guides',
    content: 'Updated guide content',
    excerpt: 'Updated excerpt',
    featured_image_url: 'https://cdn.example.com/cover.jpg',
    id: 'post-1',
    merchant_id: merchantId,
    published_at: '2026-11-15T12:00:00.000Z',
    slug: 'updated-slug',
    status: 'published',
    title: 'Updated Title',
  };

  const makeSupabase = () => ({
    functions: {
      invoke: vi.fn().mockResolvedValue({ error: null }),
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBlogEmbeddingText.mockReturnValue('embedding text');
    mockGetMerchantBlogRevalidationContext.mockResolvedValue({
      canonicalMerchantSlug: 'ogabassey',
      identifiers: ['ogabassey'],
    });
  });

  it('regenerates embedding and marks publishingNow true on non-published to published transition', async () => {
    const supabase = makeSupabase();

    await runBlogPostUpdateEffects({
      existingCategory: 'News',
      existingSlug: 'old-slug',
      existingStatus: 'scheduled',
      featuredImageUrlChanged: true,
      merchantId,
      shouldRegenerateEmbedding: true,
      supabase: supabase as never,
      updatedPost: basePost,
    });

    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'generate-embedding',
      {
        body: { id: 'post-1', text: 'embedding text', type: 'blog' },
      }
    );
    expect(mockRevalidateBlogPosts).toHaveBeenCalledWith({
      canonicalMerchantSlug: 'ogabassey',
      identifiers: ['ogabassey'],
      listingCategories: ['News', 'Guides'],
      merchantId,
      postSlugs: ['old-slug', 'updated-slug'],
    });
    expect(mockScheduleUpdatedPostEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        featuredImageUrlChanged: true,
        publishingNow: true,
      })
    );
  });

  it('gates publishingNow to false when persisted status is not newly published', async () => {
    const supabase = makeSupabase();

    await runBlogPostUpdateEffects({
      existingCategory: 'Guides',
      existingSlug: 'updated-slug',
      existingStatus: 'draft',
      featuredImageUrlChanged: false,
      merchantId,
      shouldRegenerateEmbedding: false,
      supabase: supabase as never,
      updatedPost: { ...basePost, status: 'scheduled' },
    });

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(mockScheduleUpdatedPostEffects).toHaveBeenCalledWith(
      expect.objectContaining({ publishingNow: false })
    );
  });

  it('continues scheduling updated post effects if cache revalidation lookup throws', async () => {
    const supabase = makeSupabase();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetMerchantBlogRevalidationContext.mockRejectedValue(
      new Error('cache lookup failed')
    );

    try {
      await runBlogPostUpdateEffects({
        existingCategory: null,
        existingSlug: 'updated-slug',
        existingStatus: 'published',
        featuredImageUrlChanged: false,
        merchantId,
        shouldRegenerateEmbedding: false,
        supabase: supabase as never,
        updatedPost: basePost,
      });

      expect(mockScheduleUpdatedPostEffects).toHaveBeenCalledWith(
        expect.objectContaining({
          blogRevalidation: undefined,
          publishingNow: false,
        })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
