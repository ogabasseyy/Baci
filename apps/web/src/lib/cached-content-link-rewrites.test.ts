import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetCachedProductCanonicalPaths,
  mockGetCachedStorefrontProductSlugResolution,
  mockGetPublicSupabaseClient,
} = vi.hoisted(() => ({
  mockGetCachedProductCanonicalPaths: vi.fn(),
  mockGetCachedStorefrontProductSlugResolution: vi.fn(),
  mockGetPublicSupabaseClient: vi.fn(),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/cached-data', () => ({
  getPublicSupabaseClient: mockGetPublicSupabaseClient,
}));
vi.mock('@/lib/cached-product-canonical-paths', () => ({
  getCachedProductCanonicalPaths: (...args: unknown[]) =>
    mockGetCachedProductCanonicalPaths(...args),
}));
vi.mock('@/lib/cached-storefront-product-slug-resolution', () => ({
  getCachedStorefrontProductSlugResolution: (...args: unknown[]) =>
    mockGetCachedStorefrontProductSlugResolution(...args),
}));
vi.mock('@/lib/seo-utils', () => ({
  getProductUrl: (product: {
    slug?: string;
    categories?: { slug?: string } | null;
  }) => `/${product.categories?.slug ?? 'products'}/${product.slug}`,
}));

import { cacheLife, cacheTag } from 'next/cache';
import { getBlogContentLinksCacheTag } from '@/lib/blog-content-link-cache-tags';
import { getCachedContentLinkRewrites } from '@/lib/cached-content-link-rewrites';

const ARCHIVED_UUID = '11111111-2222-4333-8444-555555555555';
const ACTIVE_UUID = '99999999-8888-4777-8666-555555555555';

interface QueryResult {
  data: unknown;
  error: unknown;
}

function createQueryBuilder(result: QueryResult) {
  // Proxy: any chained filter method (eq/in/not/ilike/or/…) returns the
  // builder, so real helpers like applyPublicBlogSqlFilters can chain freely.
  const builder: Record<string | symbol, unknown> = {};
  const proxy: unknown = new Proxy(builder, {
    get(_target, prop) {
      if (prop === 'then') {
        return (
          resolve: (value: QueryResult) => void,
          reject?: (reason: unknown) => void
        ) => Promise.resolve(result).then(resolve, reject);
      }
      return () => proxy;
    },
  });
  return proxy;
}

function setupPublicClient({
  redirectResult = { data: [], error: null },
  targetResult = { data: [], error: null },
  productResult = { data: [], error: null },
}: {
  redirectResult?: QueryResult;
  targetResult?: QueryResult;
  productResult?: QueryResult;
} = {}) {
  mockGetPublicSupabaseClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'blog_post_redirects') {
        return { select: vi.fn(() => createQueryBuilder(redirectResult)) };
      }
      if (table === 'blog_posts') {
        return { select: vi.fn(() => createQueryBuilder(targetResult)) };
      }
      if (table === 'products') {
        // Active-by-id lookup for UUID-shaped candidates (anon-visible rows).
        return { select: vi.fn(() => createQueryBuilder(productResult)) };
      }
      throw new Error(`Unexpected public table: ${table}`);
    }),
  });
}

describe('getCachedContentLinkRewrites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPublicClient();
    mockGetCachedProductCanonicalPaths.mockResolvedValue({});
    mockGetCachedStorefrontProductSlugResolution.mockResolvedValue({
      hasError: false,
      present: false,
    });
  });

  it('returns empty rewrites without querying when no slugs are collected', async () => {
    const rewrites = await getCachedContentLinkRewrites('merchant-1', [], []);

    expect(rewrites).toEqual({ blogSlugs: {}, productPaths: {} });
    expect(mockGetPublicSupabaseClient).not.toHaveBeenCalled();
    expect(mockGetCachedStorefrontProductSlugResolution).not.toHaveBeenCalled();
  });

  it('sets merchant-scoped remote cache tags', async () => {
    await getCachedContentLinkRewrites('merchant-1', ['post'], []);

    expect(cacheLife).toHaveBeenCalledWith('merchant');
    expect(cacheTag).toHaveBeenCalledWith(
      getBlogContentLinksCacheTag('merchant-1'),
      'blog-content-links',
      'product-legacy-redirect',
      'products-merchant-1',
      'categories-merchant-1'
    );
    expect(vi.mocked(cacheTag).mock.calls.flat()).not.toContain('blog-posts');
  });

  it('returns canonical paths for live products and opts into throwing lookups', async () => {
    mockGetCachedProductCanonicalPaths.mockResolvedValueOnce({
      'apple-airpods-2': '/earbuds/apple-airpods-2',
    });

    const rewrites = await getCachedContentLinkRewrites(
      'merchant-1',
      [],
      ['apple-airpods-2']
    );

    expect(rewrites.productPaths['apple-airpods-2']).toBe(
      '/earbuds/apple-airpods-2'
    );
    expect(mockGetCachedProductCanonicalPaths).toHaveBeenCalledWith(
      'merchant-1',
      ['apple-airpods-2'],
      { throwOnQueryError: true }
    );
    // live slugs never reach the archived-alias RPC
    expect(mockGetCachedStorefrontProductSlugResolution).not.toHaveBeenCalled();
  });

  it('maps archived variant slugs to the parent path via the anon RPC resolution', async () => {
    mockGetCachedStorefrontProductSlugResolution.mockResolvedValueOnce({
      hasError: false,
      present: true,
      redirectTarget: {
        id: 'p1',
        name: 'iPhone 13 Pro',
        slug: 'iphone-13-pro',
        categories: { id: 'c1', name: 'Smartphones', slug: 'smartphones' },
      },
    });

    const rewrites = await getCachedContentLinkRewrites(
      'merchant-1',
      [],
      ['iphone-13-pro-6gb-256gb']
    );

    expect(rewrites.productPaths['iphone-13-pro-6gb-256gb']).toBe(
      '/smartphones/iphone-13-pro'
    );
    expect(mockGetCachedStorefrontProductSlugResolution).toHaveBeenCalledWith(
      'merchant-1',
      'iphone-13-pro-6gb-256gb'
    );
  });

  it('propagates a slug-resolution failure instead of treating it as no-rewrite', async () => {
    mockGetCachedStorefrontProductSlugResolution.mockResolvedValueOnce({
      hasError: true,
      present: false,
    });

    await expect(
      getCachedContentLinkRewrites('merchant-1', [], ['some-archived-slug'])
    ).rejects.toThrow('Product slug resolution failed');
  });

  it('rewrites archived UUID links via the anon slug-resolution RPC', async () => {
    mockGetCachedStorefrontProductSlugResolution.mockResolvedValueOnce({
      hasError: false,
      present: true,
      redirectTarget: {
        id: 'p2',
        name: 'iPhone X',
        slug: 'iphone-x',
        categories: { id: 'c1', name: 'Smartphones', slug: 'smartphones' },
      },
    });

    const rewrites = await getCachedContentLinkRewrites(
      'merchant-1',
      [],
      [ARCHIVED_UUID]
    );

    // the RPC matches UUID-shaped input against product ids (anon,
    // SECURITY DEFINER) — no service-role access anywhere in this flow
    expect(rewrites.productPaths[ARCHIVED_UUID]).toBe('/smartphones/iphone-x');
    expect(mockGetCachedStorefrontProductSlugResolution).toHaveBeenCalledWith(
      'merchant-1',
      ARCHIVED_UUID
    );
  });

  it('rewrites active UUID links to the canonical path of their slug', async () => {
    setupPublicClient({
      productResult: {
        data: [{ id: ACTIVE_UUID, slug: 'google-pixel-9-pro' }],
        error: null,
      },
    });
    mockGetCachedProductCanonicalPaths.mockResolvedValue({
      'google-pixel-9-pro': '/smartphones/google-pixel-9-pro',
    });

    const rewrites = await getCachedContentLinkRewrites(
      'merchant-1',
      [],
      [ACTIVE_UUID]
    );

    expect(rewrites.productPaths[ACTIVE_UUID]).toBe(
      '/smartphones/google-pixel-9-pro'
    );
  });

  it('maps renamed blog slugs to their published target slug', async () => {
    setupPublicClient({
      redirectResult: {
        data: [
          { source_slug: 'buying-a-used-iphone-in-2025', target_post_id: 'p1' },
        ],
        error: null,
      },
      targetResult: {
        data: [
          {
            id: 'p1',
            slug: 'the-ultimate-checklist',
            title: 'The Ultimate Checklist',
          },
        ],
        error: null,
      },
    });

    const rewrites = await getCachedContentLinkRewrites(
      'merchant-1',
      ['buying-a-used-iphone-in-2025'],
      []
    );

    expect(rewrites.blogSlugs['buying-a-used-iphone-in-2025']).toBe(
      'the-ultimate-checklist'
    );
  });

  it('omits blog rewrites whose redirect target is suppressed by public filters', async () => {
    setupPublicClient({
      redirectResult: {
        data: [{ source_slug: 'renamed-post', target_post_id: 'p2' }],
        error: null,
      },
      targetResult: {
        data: [{ id: 'p2', slug: 'test-artifact', title: 'test post draft' }],
        error: null,
      },
    });

    const rewrites = await getCachedContentLinkRewrites(
      'merchant-1',
      ['renamed-post'],
      []
    );

    expect(rewrites.blogSlugs).toEqual({});
  });

  it('ignores redirect rows whose source slug is a live public post again', async () => {
    setupPublicClient({
      redirectResult: {
        data: [{ source_slug: 'republished-post', target_post_id: 'p3' }],
        error: null,
      },
      // the same builder serves both target and live-source lookups; a live
      // public post exists at the SOURCE slug, so the redirect must not apply
      targetResult: {
        data: [
          { id: 'p3', slug: 'new-home', title: 'New Home' },
          { slug: 'republished-post', title: 'Republished Post' },
        ],
        error: null,
      },
    });

    const rewrites = await getCachedContentLinkRewrites(
      'merchant-1',
      ['republished-post'],
      []
    );

    expect(rewrites.blogSlugs).toEqual({});
  });

  it('throws when the blog redirects query returns an error', async () => {
    setupPublicClient({
      redirectResult: { data: null, error: new Error('redirects query down') },
    });

    await expect(
      getCachedContentLinkRewrites('merchant-1', ['renamed-post'], [])
    ).rejects.toThrow('redirects query down');
  });

  it('throws when the active-UUID products query returns an error', async () => {
    setupPublicClient({
      productResult: { data: null, error: new Error('products query down') },
    });

    await expect(
      getCachedContentLinkRewrites('merchant-1', [], [ACTIVE_UUID])
    ).rejects.toThrow('products query down');
  });

  it('normalizes legacy alias category segments in rewrite paths', async () => {
    mockGetCachedProductCanonicalPaths.mockResolvedValueOnce({
      'iphone-13-pro': '/phones/iphone-13-pro',
    });

    const rewrites = await getCachedContentLinkRewrites(
      'merchant-1',
      [],
      ['iphone-13-pro']
    );

    expect(rewrites.productPaths['iphone-13-pro']).toBe(
      '/smartphones/iphone-13-pro'
    );
  });

  it('falls back to stripping trailing RAM/storage capacity suffixes when a variant slug has no archived row', async () => {
    mockGetCachedProductCanonicalPaths
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        'google-pixel-6': '/smartphones/google-pixel-6',
      });
    mockGetCachedStorefrontProductSlugResolution.mockResolvedValueOnce({
      hasError: false,
      present: false,
    });

    const rewrites = await getCachedContentLinkRewrites(
      'merchant-1',
      [],
      ['google-pixel-6-8gb-256gb']
    );

    expect(rewrites.productPaths['google-pixel-6-8gb-256gb']).toBe(
      '/smartphones/google-pixel-6'
    );
    expect(mockGetCachedProductCanonicalPaths).toHaveBeenNthCalledWith(
      2,
      'merchant-1',
      ['google-pixel-6'],
      { throwOnQueryError: true }
    );
  });
});

describe('cached-content-link-rewrites cache directive', () => {
  const source = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      'cached-content-link-rewrites.ts'
    ),
    'utf8'
  );

  it('stays on the shared remote cache handler so rewrite invalidation reaches every instance (PR4b review r4)', () => {
    // Demotion REVERTED. Tagged `blog-posts`, `product-legacy-redirect`,
    // `products-${id}` and `categories-${id}` — every one is busted by a live
    // revalidator (revalidateBlogPosts/revalidateBlogFeed, revalidateProducts,
    // revalidateCategories). Link rewriting is precisely the contract that must
    // propagate: after a product is archived or a blog slug renamed, an
    // instance holding a LOCAL entry would keep rewriting links to a dead
    // target. Still fail-loud (every lookup throws).
    expect(source).toContain("'use cache: remote';");
    expect(source).not.toContain("'use cache';");
  });
});
