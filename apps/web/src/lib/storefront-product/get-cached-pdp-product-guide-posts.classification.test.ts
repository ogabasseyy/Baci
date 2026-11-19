import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedPdpProductGuidePosts } from './get-cached-pdp-product-guide-posts';

const mocks = vi.hoisted(() => ({
  getPublicSupabaseClient: vi.fn(),
  createPublicClient: vi.fn(),
  rpc: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/public-supabase-client', () => ({
  getPublicSupabaseClient: () => mocks.getPublicSupabaseClient(),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => mocks.createPublicClient(),
}));

const post = {
  id: '11111111-1111-4111-8111-111111111111',
  classification_revision: '22222222-2222-4222-8222-222222222222',
  slug: 'iphone-buying-guide-launch',
  title: 'iPhone buying guide launch news',
  excerpt: 'Latest iPhone announcement',
  category: 'Smartphones',
  tags: ['buying-guide'],
  keywords: ['iphone'],
  featured_image_url: null,
  published_at: '2026-01-01T10:00:00Z',
  reading_time_minutes: 3,
  status: 'published',
};

function classification(
  intent: string,
  revision = post.classification_revision
) {
  return {
    post_id: post.id,
    post_revision: revision,
    intent,
    source: 'verified_receipt',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const result = { data: [{ blog_posts: post }], error: null };
  const query = {
    select: () => query,
    eq: () => query,
    not: () => query,
    order: () => query,
    limit: () => query,
    abortSignal: () => query,
    retry: () => query,
    // biome-ignore lint/suspicious/noThenProperty: models the PostgREST I/O boundary
    then: (resolve: (value: typeof result) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  mocks.getPublicSupabaseClient.mockReturnValue({ from: () => query });
  mocks.createPublicClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockReturnValue({
    abortSignal: () => ({ retry: mocks.retry }),
  });
  mocks.retry.mockResolvedValue({ data: [], error: null });
});

describe('product-linked guide classification', () => {
  it('excludes current news even when a product link and buying-guide title exist', async () => {
    mocks.retry.mockResolvedValue({
      data: [classification('news')],
      error: null,
    });
    expect(
      await getCachedPdpProductGuidePosts('merchant-1', 'product-1')
    ).toEqual([]);
  });

  it('preserves current guide intent on the linked-post path', async () => {
    mocks.retry.mockResolvedValue({
      data: [classification('comparison')],
      error: null,
    });
    expect(
      await getCachedPdpProductGuidePosts('merchant-1', 'product-1')
    ).toEqual([
      expect.objectContaining({
        slug: post.slug,
        merchant_intent: 'comparison',
        merchant_intent_source: 'verified_receipt',
      }),
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'get_storefront_blog_classifications_v1',
      {
        p_merchant_id: 'merchant-1',
        p_post_ids: [post.id],
      }
    );
  });

  it('does not let stale news metadata suppress the current linked article', async () => {
    mocks.retry.mockResolvedValue({
      data: [classification('news', '33333333-3333-4333-8333-333333333333')],
      error: null,
    });
    const posts = await getCachedPdpProductGuidePosts(
      'merchant-1',
      'product-1'
    );
    expect(posts).toHaveLength(1);
    expect(posts[0].merchant_intent).toBeUndefined();
  });

  it('retains the legacy linked guide when no classification exists', async () => {
    const posts = await getCachedPdpProductGuidePosts(
      'merchant-1',
      'product-1'
    );
    expect(posts).toHaveLength(1);
    expect(posts[0].slug).toBe(post.slug);
    expect(posts[0].merchant_intent).toBeUndefined();
  });

  it('does not suppress linked posts based on untrusted news metadata', async () => {
    mocks.retry.mockResolvedValue({
      data: [{ ...classification('news'), source: 'untrusted' }],
      error: null,
    });
    const posts = await getCachedPdpProductGuidePosts(
      'merchant-1',
      'product-1'
    );
    expect(posts).toHaveLength(1);
    expect(posts[0].merchant_intent).toBeUndefined();
  });

  it('keeps the linked guide on metadata failure and excludes news after recovery', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mocks.retry.mockResolvedValueOnce({ data: null, error: { code: '503' } });
      const fallback = await getCachedPdpProductGuidePosts(
        'merchant-1',
        'product-1'
      );
      expect(fallback).toHaveLength(1);
      expect(fallback[0].slug).toBe(post.slug);
      expect(fallback[0].merchant_intent).toBeUndefined();

      mocks.retry.mockResolvedValueOnce({
        data: [classification('news')],
        error: null,
      });
      expect(
        await getCachedPdpProductGuidePosts('merchant-1', 'product-1')
      ).toEqual([]);
    } finally {
      warning.mockRestore();
    }
  });
});
