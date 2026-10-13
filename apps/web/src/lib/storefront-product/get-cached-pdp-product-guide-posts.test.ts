import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedPdpProductGuidePosts } from './get-cached-pdp-product-guide-posts';

const source = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    'get-cached-pdp-product-guide-posts.ts'
  ),
  'utf8'
);

const mocks = vi.hoisted(() => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  getPublicSupabaseClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  cacheLife: (...args: unknown[]) => mocks.cacheLife(...args),
  cacheTag: (...args: unknown[]) => mocks.cacheTag(...args),
}));

vi.mock('@/lib/public-supabase-client', () => ({
  getPublicSupabaseClient: () => mocks.getPublicSupabaseClient(),
}));

function createProductGuideQuery(result: {
  data?: unknown[] | null;
  error?: unknown;
}) {
  const query = {
    abortSignal: vi.fn(() => query),
    eq: vi.fn(() => query),
    limit: vi.fn(() => query),
    not: vi.fn(() => query),
    order: vi.fn(() => query),
    retry: vi.fn(() => query),
    select: vi.fn(() => query),
    // biome-ignore lint/suspicious/noThenProperty: mock intentionally mimics a PostgREST thenable
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

describe('getCachedPdpProductGuidePosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the product-keyed entry off the remote cache handler', () => {
    expect(source).toContain("'use cache';");
    expect(source).not.toContain("'use cache: remote';");
  });

  it('loads only published product-linked posts with one bounded attempt', async () => {
    const query = createProductGuideQuery({
      data: [
        {
          blog_posts: {
            category: 'Laptops',
            excerpt: 'A guide',
            featured_image_url: null,
            keywords: ['laptops'],
            published_at: '2026-08-31T10:00:00.000Z',
            reading_time_minutes: 5,
            slug: 'lenovo-legion-guide',
            status: 'published',
            tags: ['buying-guide'],
            title: 'Lenovo Legion Guide',
          },
        },
      ],
      error: null,
    });
    mocks.getPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    await expect(
      getCachedPdpProductGuidePosts('merchant-1', 'product-1')
    ).resolves.toEqual([
      {
        category: 'Laptops',
        excerpt: 'A guide',
        featured_image_url: null,
        keywords: ['laptops'],
        published_at: '2026-08-31T10:00:00.000Z',
        reading_time_minutes: 5,
        slug: 'lenovo-legion-guide',
        tags: ['buying-guide'],
        title: 'Lenovo Legion Guide',
      },
    ]);

    expect(query.select).toHaveBeenCalledWith(
      expect.stringContaining('blog_posts!inner')
    );
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.eq).toHaveBeenCalledWith('product_id', 'product-1');
    expect(query.eq).toHaveBeenCalledWith(
      'blog_posts.merchant_id',
      'merchant-1'
    );
    expect(query.eq).toHaveBeenCalledWith('blog_posts.status', 'published');
    expect(query.limit).toHaveBeenCalledWith(8);
    expect(query.retry).toHaveBeenCalledWith(false);
    expect(mocks.cacheLife).toHaveBeenCalledWith('blog');
    expect(mocks.cacheTag).toHaveBeenCalledWith(
      'blog-posts',
      'products-merchant-1',
      'published-product-guide-posts-merchant-1-product-1'
    );
  });

  it('does not query when the product identifier is empty', async () => {
    mocks.getPublicSupabaseClient.mockReturnValue({ from: vi.fn() });

    await expect(
      getCachedPdpProductGuidePosts('merchant-1', '')
    ).resolves.toEqual([]);
    expect(mocks.getPublicSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.cacheLife).not.toHaveBeenCalled();
    expect(mocks.cacheTag).not.toHaveBeenCalled();
  });

  it('does not derive a cache key for a whitespace-only product identifier', async () => {
    await expect(
      getCachedPdpProductGuidePosts('merchant-1', '   ')
    ).resolves.toEqual([]);
    expect(mocks.getPublicSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.cacheLife).not.toHaveBeenCalled();
    expect(mocks.cacheTag).not.toHaveBeenCalled();
  });

  it('throws transient failures so the caller can degrade guides without caching them', async () => {
    const query = createProductGuideQuery({
      data: null,
      error: { message: 'statement timeout' },
    });
    mocks.getPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    await expect(
      getCachedPdpProductGuidePosts('merchant-1', 'product-1')
    ).rejects.toMatchObject({ message: 'statement timeout' });
  });

  it('skips malformed published rows instead of returning unsafe guide data', async () => {
    const query = createProductGuideQuery({
      data: [
        {
          blog_posts: {
            excerpt: null,
            featured_image_url: null,
            keywords: 'invalid',
            published_at: '2026-08-31T10:00:00.000Z',
            slug: 'bad-guide',
            title: 'Bad guide',
          },
        },
      ],
      error: null,
    });
    mocks.getPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => query),
    });

    await expect(
      getCachedPdpProductGuidePosts('merchant-1', 'product-1')
    ).resolves.toEqual([]);
  });

  it('rejects with TimeoutError when the query ignores AbortSignal after the 3-second deadline', async () => {
    vi.useFakeTimers();
    try {
      const query = createProductGuideQuery({ data: [], error: null });
      // biome-ignore lint/suspicious/noThenProperty: this regression deliberately models an abort-ignoring PostgREST thenable
      query.then = (() => new Promise(() => undefined)) as typeof query.then;
      mocks.getPublicSupabaseClient.mockReturnValue({
        from: vi.fn(() => query),
      });
      const pending = getCachedPdpProductGuidePosts('merchant-1', 'product-1');
      const assertion = expect(pending).rejects.toMatchObject({
        name: 'TimeoutError',
      });
      await vi.advanceTimersByTimeAsync(3_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
