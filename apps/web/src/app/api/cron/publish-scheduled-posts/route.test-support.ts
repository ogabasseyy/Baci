import { vi } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';

export const mockGetMerchantBlogCacheIdentifiers = vi.fn();
export const mockRevalidateBlogPosts = vi.fn();
export const mockDispatchZohoBlogCampaign = vi.fn();
export const mockPrewarmOgabasseyImageTransforms = vi
  .fn()
  .mockResolvedValue(undefined);
export const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
export const managedFeaturedImageUrl = `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/storage/v1/object/public/media/${merchantId}/blog/cover.png`;
export const managedLandscapeVariantUrl = `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/storage/v1/object/public/media/${merchantId}/blog/upload-1/landscape_16x9.webp`;

const createServiceClientMock = () => {
  const mock = {
    eq: vi.fn(),
    from: vi.fn(),
    in: vi.fn(),
    lte: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  };
  mock.from.mockReturnValue(mock);
  mock.select.mockReturnValue(mock);
  mock.eq.mockReturnValue(mock);
  mock.update.mockReturnValue(mock);
  return mock;
};

export const mockSupabase = createServiceClientMock();

vi.mock('@/env', () => ({ getCronSecret: () => 'test-secret' }));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateBlogPosts: (...args: unknown[]) => mockRevalidateBlogPosts(...args),
}));
vi.mock('@/lib/get-merchant-blog-cache-identifiers', () => ({
  getMerchantBlogRevalidationContext: (...args: unknown[]) =>
    mockGetMerchantBlogCacheIdentifiers(...args),
}));
vi.mock('@/lib/ogabassey-image-prewarm', () => ({
  prewarmOgabasseyImageTransforms: (...args: unknown[]) =>
    mockPrewarmOgabasseyImageTransforms(...args),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockSupabase,
}));
vi.mock('@/lib/zoho-blog-campaign-server', () => ({
  dispatchConfiguredZohoBlogCampaign: (...args: unknown[]) =>
    mockDispatchZohoBlogCampaign(...args),
}));

export const { GET, POST } = await import('./route');

export function createCronRequest(method: 'GET' | 'POST' = 'POST') {
  return new Request('http://localhost/api/cron/publish-scheduled-posts', {
    method,
    headers: { Authorization: 'Bearer test-secret' },
  });
}

export function resetCronRouteMocks() {
  vi.clearAllMocks();
  Object.assign(mockSupabase, createServiceClientMock());
  vi.stubEnv('CRON_SECRET', 'test-secret');
  mockGetMerchantBlogCacheIdentifiers.mockResolvedValue({
    identifiers: ['test-store'],
    canonicalMerchantSlug: 'test-store',
  });
  mockDispatchZohoBlogCampaign.mockResolvedValue({
    postId: 'post-1',
    reason: 'Zoho Campaigns disabled',
    status: 'skipped',
  });
}

export function configurePublishFlow(
  posts: Record<string, unknown>[],
  options: {
    featureSettings?: Record<string, unknown>[];
    publishedPosts?: Record<string, unknown>[];
    claimedPostIds?: string[];
  } = {}
) {
  mockSupabase.lte.mockResolvedValue({ data: posts, error: null });
  mockSupabase.in
    .mockResolvedValueOnce({
      data:
        options.featureSettings ??
        posts.map((post) => ({
          merchant_id: post.merchant_id,
          blog_discover_image_validation_enabled: false,
        })),
      error: null,
    })
    .mockResolvedValueOnce({ data: options.publishedPosts ?? [], error: null })
    .mockImplementationOnce((_column, ids: string[]) => {
      mockSupabase.select.mockResolvedValueOnce({
        data: (options.claimedPostIds ?? ids).map((id) => ({ id })),
        error: null,
      });
      return mockSupabase;
    });
  mockSupabase.select
    .mockReturnValueOnce(mockSupabase)
    .mockReturnValueOnce(mockSupabase)
    .mockReturnValueOnce(mockSupabase);
}

export function createScheduledPost(overrides: Record<string, unknown> = {}) {
  return {
    category: 'guides',
    featured_image_height: null,
    featured_image_url: null,
    featured_image_variants: {},
    featured_image_width: null,
    id: 'post-1',
    merchant_id: 'merchant-1',
    slug: 'scheduled-post',
    title: 'Scheduled post',
    ...overrides,
  };
}
