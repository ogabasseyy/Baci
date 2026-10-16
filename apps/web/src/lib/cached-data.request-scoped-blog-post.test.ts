import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();

vi.mock('@/env', () => ({
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'test-anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'test-service-role-key'),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

// Every Map created by the mocked cache() below is registered here so
// beforeEach can clear it, giving each test a fresh "request" instead of
// relying on every test using a unique postSlug to dodge collisions.
const { cacheRegistry } = vi.hoisted(() => ({
  cacheRegistry: [] as Map<string, unknown>[],
}));

// This repo's Vitest config resolves a plain `require.resolve('react')`
// (vitest.config.ts), which has no `react-server` export condition. Real
// React's `cache()` for that build is an inert passthrough — it always calls
// `fn` directly with no memoization (verified against
// node_modules/react/cjs/react.development.js: `exports.cache = function
// (fn) { return function () { return fn.apply(null, arguments); }; };`).
// Every other cached-data*.test.ts mocks `cache()` as identity for the same
// reason. Mock it here as a genuine per-argument memoizer instead, so this
// test can actually exercise and prove the dedup behavior
// getRequestScopedBlogPost exists to provide — the real dispatcher-based
// memoization only activates inside a live Next.js request/render scope,
// which Vitest does not reproduce.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<ReactModule>();
  return {
    ...actual,
    cache: <Fn extends (...args: never[]) => unknown>(fn: Fn): Fn => {
      const resultsByKey = new Map<string, ReturnType<Fn>>();
      cacheRegistry.push(resultsByKey);
      return ((...args: Parameters<Fn>) => {
        const key = JSON.stringify(args);
        if (!resultsByKey.has(key)) {
          resultsByKey.set(key, fn(...args) as ReturnType<Fn>);
        }
        return resultsByKey.get(key);
      }) as Fn;
    },
  };
});

import { getRequestScopedBlogPost } from '@/lib/cached-data';

type ReactModule = typeof import('react');

function createQueryBuilder({
  queryResult = { data: [], error: null },
  singleResult = { data: null, error: null },
}: {
  queryResult?: { data: unknown; error: unknown };
  singleResult?: { data: unknown; error: unknown };
}) {
  const builder = {
    eq: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue(singleResult),
    neq: vi.fn(() => builder),
    not: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue(singleResult),
  };

  Object.defineProperty(builder, 'then', {
    value: (
      resolve: (value: { data: unknown; error: unknown }) => void,
      reject?: (reason: unknown) => void
    ) => Promise.resolve(queryResult).then(resolve, reject),
  });

  return builder;
}

function buildMerchantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'merchant-1',
    business_name: 'Ogabassey',
    slug: 'ogabassey',
    feature_settings: { blog_enabled: true },
    ...overrides,
  };
}

function buildBlogPostRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    slug: 'factory-unlocked-iphones-explained',
    title: 'Factory Unlocked iPhones: Explained',
    ...overrides,
  };
}

// Mirrors setupBlogPostFetch in cached-data.blog-post.test.ts, trimmed to the
// minimum getCachedBlogPost's real implementation still needs to complete one
// full run without throwing (post lookup + related posts + category-related
// posts + blog product links + fallback related products).
function setupBlogPostFetch(publishedPost: Record<string, unknown>) {
  const postLookupBuilder = createQueryBuilder({
    singleResult: { data: publishedPost, error: null },
  });
  const relatedPostsBuilder = createQueryBuilder({});
  const categoryRelatedPostsBuilder = createQueryBuilder({});
  const linkedProductsBuilder = createQueryBuilder({});
  const relatedProductsBuilder = createQueryBuilder({});
  const featureSettingsBuilder = createQueryBuilder({
    singleResult: { data: { blog_enabled: true }, error: null },
  });

  // Merchant-by-domain resolution happens in one public-safe bounded RPC
  // (resolve_storefront_public_snapshot_v2) — mirrors the updated
  // setupBlogPostFetch in cached-data.blog-post.test.ts.
  const serviceRpc = vi.fn((fnName: string) => {
    if (fnName === 'resolve_storefront_public_snapshot_v2') {
      return Promise.resolve({
        data: [
          {
            resolution_status: 'found',
            custom_domain: 'ogabassey.com',
            feature_settings: { blog_enabled: true },
            merchant_data: buildMerchantRow(),
          },
        ],
        error: null,
        status: 200,
      });
    }

    throw new Error(`Unexpected service RPC: ${fnName}`);
  });

  const serviceFrom = vi.fn((table: string) => {
    if (table === 'merchant_feature_settings') {
      return { select: vi.fn(() => featureSettingsBuilder) };
    }

    throw new Error(`Unexpected service table: ${table}`);
  });

  const blogBuilders = [
    postLookupBuilder,
    relatedPostsBuilder,
    categoryRelatedPostsBuilder,
  ];
  const publicFrom = vi.fn((table: string) => {
    if (table === 'blog_posts') {
      return {
        select: vi.fn(() => {
          const builder = blogBuilders.shift();
          if (!builder) {
            throw new Error('Unexpected extra blog_posts query');
          }
          return builder;
        }),
      };
    }

    if (table === 'blog_post_products') {
      return { select: vi.fn(() => linkedProductsBuilder) };
    }

    if (table === 'products') {
      return { select: vi.fn(() => relatedProductsBuilder) };
    }

    throw new Error(`Unexpected public table: ${table}`);
  });

  mockCreateClient.mockImplementation(
    (_url: string, key: string, _options?: unknown) => {
      if (key === 'test-service-role-key') {
        return { from: serviceFrom, rpc: serviceRpc };
      }

      if (key === 'test-anon-key') {
        // The anon client owns the public snapshot RPC (the runtime snapshot
        // client IS the public client — see getStorefrontSnapshotSupabaseClient).
        return { from: publicFrom, rpc: serviceRpc };
      }

      throw new Error(`Unexpected Supabase key: ${key}`);
    }
  );

  return { postLookupBuilder, serviceRpc };
}

describe('getRequestScopedBlogPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // getRequestScopedBlogPost is a module-level cache() singleton (mirroring
    // real Next.js request-scoping), so its Map is cleared before every test
    // to isolate each test's "request" instead of relying on every test
    // using a unique postSlug to dodge stale cross-test cache hits.
    for (const cache of cacheRegistry) {
      cache.clear();
    }
  });

  it('invokes the underlying blog post fetch once when called three times with the same arguments in one pass (generateMetadata + hero-shell + streamed body)', async () => {
    const { postLookupBuilder, serviceRpc } = setupBlogPostFetch(
      buildBlogPostRow({ slug: 'test-post' })
    );

    const first = await getRequestScopedBlogPost(
      'ogabassey.com',
      'test-post',
      false
    );
    const second = await getRequestScopedBlogPost(
      'ogabassey.com',
      'test-post',
      false
    );
    const third = await getRequestScopedBlogPost(
      'ogabassey.com',
      'test-post',
      false
    );

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(serviceRpc).toHaveBeenCalledTimes(1);
    expect(postLookupBuilder.single).toHaveBeenCalledTimes(1);
  });

  it('runs a fresh fetch for a different postSlug', async () => {
    // Each real execution consumes a 3-item blog_posts builder queue (post
    // lookup + related posts + category-related posts), so the mock is
    // re-armed between the two genuinely-distinct fetches this test expects.
    const { postLookupBuilder: firstLookup } = setupBlogPostFetch(
      buildBlogPostRow({ slug: 'first-post' })
    );
    await getRequestScopedBlogPost('ogabassey.com', 'first-post', false);
    expect(firstLookup.single).toHaveBeenCalledTimes(1);

    const { postLookupBuilder: secondLookup } = setupBlogPostFetch(
      buildBlogPostRow({ slug: 'second-post' })
    );
    await getRequestScopedBlogPost('ogabassey.com', 'second-post', false);
    expect(secondLookup.single).toHaveBeenCalledTimes(1);
  });

  it('runs a fresh fetch when includeDrafts differs for the same identifier/postSlug', async () => {
    // Same identifier/postSlug, different includeDrafts — cache() keys on
    // the full argument tuple, so this is still a fresh fetch even though
    // the cache Map itself was already cleared by beforeEach.
    const { postLookupBuilder: firstLookup, serviceRpc: firstRpc } =
      setupBlogPostFetch(buildBlogPostRow({ slug: 'test-post' }));
    await getRequestScopedBlogPost('ogabassey.com', 'test-post', false);
    expect(firstRpc).toHaveBeenCalledTimes(1);
    expect(firstLookup.single).toHaveBeenCalledTimes(1);

    const { postLookupBuilder: secondLookup, serviceRpc: secondRpc } =
      setupBlogPostFetch(buildBlogPostRow({ slug: 'test-post' }));
    await getRequestScopedBlogPost('ogabassey.com', 'test-post', true);
    expect(secondRpc).toHaveBeenCalledTimes(1);
    expect(secondLookup.single).toHaveBeenCalledTimes(1);
  });
});
