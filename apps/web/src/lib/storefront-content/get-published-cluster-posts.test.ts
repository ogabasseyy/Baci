import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublishedClusterPosts } from './get-published-cluster-posts';

const mockRpc = vi.fn();
const mockCreatePublicClient = vi.fn();
const mockCacheLife = vi.fn();
const mockCacheTag = vi.fn();

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: (...args: unknown[]) => mockCreatePublicClient(...args),
}));

vi.mock('next/cache', () => ({
  cacheLife: (...args: unknown[]) => mockCacheLife(...args),
  cacheTag: (...args: unknown[]) => mockCacheTag(...args),
}));

// The RPC result is chained through `.abortSignal().retry(false)` (the fix that
// bounds this optional read and disables the PostgREST TimeoutError retry
// storm) before being awaited, so the mock returns a chainable thenable.
function createRpcQuery(result: { data?: unknown; error?: unknown }) {
  const query = {
    abortSignal: vi.fn(() => query),
    retry: vi.fn(() => query),
    // biome-ignore lint/suspicious/noThenProperty: mock intentionally mimics postgrest-js's thenable query builder
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

const context = {
  pageKind: 'compare' as const,
  categorySlug: 'smartphones' as const,
  brands: ['Apple'],
  productSlugs: ['iphone-15-pro', 'samsung-galaxy-s25'],
};

describe('getPublishedClusterPosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockReturnValue(
      createRpcQuery({
        data: [
          {
            slug: 'iphone-15-pro-vs-galaxy-s25',
            title: 'iPhone 15 Pro vs Galaxy S25',
            excerpt: 'Compare both phones.',
            category: 'Smartphones',
            tags: ['comparison'],
            keywords: ['iphone', 'galaxy'],
            featured_image_url: null,
            published_at: '2026-04-10T09:00:00.000Z',
            reading_time_minutes: 6,
          },
        ],
        error: null,
      })
    );
    mockCreatePublicClient.mockReturnValue({ rpc: mockRpc });
  });

  it('caches locally with the blog profile and merchant-scoped invalidation tags', async () => {
    await getPublishedClusterPosts('merchant-1', context);

    expect(mockCacheLife).toHaveBeenCalledWith('blog');
    expect(mockCacheTag).toHaveBeenCalledWith(
      'blog-posts',
      'products-merchant-1',
      'features-merchant-1'
    );
  });

  it('loads a bounded, context-ranked candidate set through the public RPC', async () => {
    const result = await getPublishedClusterPosts('merchant-1', context);

    expect(mockCreatePublicClient).toHaveBeenCalledWith({
      clientInfo: 'baci-web-storefront-cluster-guides',
      timeoutMs: 3000,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_cluster_guide_candidates_v1',
      expect.objectContaining({
        p_category_slug: 'smartphones',
        p_cluster_rules: expect.arrayContaining([
          expect.objectContaining({
            category_slug: 'smartphones',
            category_names: expect.arrayContaining(['smartphones', 'phones']),
            article_tokens: expect.arrayContaining(['phone', 'battery']),
          }),
        ]),
        p_merchant_id: 'merchant-1',
        p_limit: 64,
        p_search_query: expect.stringContaining('"smartphones"'),
      })
    );
    const rpcArgs = mockRpc.mock.calls[0]?.[1];
    expect(rpcArgs.p_cluster_rules).toHaveLength(26);
    expect(
      Buffer.byteLength(JSON.stringify(rpcArgs.p_cluster_rules), 'utf8')
    ).toBeLessThanOrEqual(8192);
    expect(rpcArgs.p_cluster_rules[0]).toMatchObject({
      rule_order: 0,
      category_slug: 'smartphones',
    });
    expect(result).toEqual([
      expect.objectContaining({
        slug: 'iphone-15-pro-vs-galaxy-s25',
        category: 'Smartphones',
      }),
    ]);
  });

  it('passes index-compatible symbol fallbacks to the candidate RPC', async () => {
    await getPublishedClusterPosts('merchant-1', {
      pageKind: 'product',
      categorySlug: 'gift-cards',
      productNames: ['PSN Card £50 Gift Card'],
      productSlugs: [],
    });

    expect(mockRpc.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        p_search_query: expect.stringContaining('"psn card 50 gift card"'),
      })
    );
  });

  it('preserves stop-word positions in product-name fallbacks sent to the candidate RPC', async () => {
    await getPublishedClusterPosts('merchant-1', {
      pageKind: 'product',
      categorySlug: 'playstation-4',
      brands: ['PlayStation'],
      productNames: ['PS4 Fast and Furious Spy Racers'],
      productSlugs: [],
    });

    expect(mockRpc.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        p_search_query: expect.stringContaining(
          '"ps4 fast and furious spy racers"'
        ),
      })
    );
  });

  it('returns an empty candidate set when the RPC succeeds without rows', async () => {
    mockRpc.mockReturnValueOnce(createRpcQuery({ data: null, error: null }));

    await expect(
      getPublishedClusterPosts('merchant-1', context)
    ).resolves.toEqual([]);
  });

  it('throws RPC failures so callers can degrade without caching the failure', async () => {
    mockRpc.mockReturnValueOnce(
      createRpcQuery({
        data: null,
        error: { code: '57014', message: 'statement timeout' },
      })
    );

    await expect(
      getPublishedClusterPosts('merchant-1', context)
    ).rejects.toMatchObject({ code: '57014' });
  });
});
