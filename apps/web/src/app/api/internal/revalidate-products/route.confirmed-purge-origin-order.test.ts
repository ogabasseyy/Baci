import type { WorkStore } from 'next/dist/server/app-render/work-async-storage.external';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??=
    AsyncLocalStorage;
});

const mockGetInternalApiSecret = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockPurgeStorefrontProductConfirmed = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();
const mockPurgeStorefrontHostnameConfirmed = vi.fn();
const mockCreatePublicClient = vi.fn();

vi.mock('@/env', () => ({
  getInternalApiSecret: () => mockGetInternalApiSecret(),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
  purgeStorefrontProductConfirmed: (...args: unknown[]) =>
    mockPurgeStorefrontProductConfirmed(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
  purgeStorefrontHostnameConfirmed: (...args: unknown[]) =>
    mockPurgeStorefrontHostnameConfirmed(...args),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: (...args: unknown[]) => mockCreatePublicClient(...args),
  createClient: (...args: unknown[]) => mockCreatePublicClient(...args),
}));
vi.mock('@/lib/get-published-blog-post-slugs-for-products', () => ({
  getPublishedBlogPostSlugsForProducts: () =>
    Promise.resolve({ slugs: [], incomplete: false }),
}));
vi.mock('@/lib/resolve-dependent-legacy-product-identifiers', () => ({
  resolveDependentLegacyProductIdentifiers: () =>
    Promise.resolve({ identifiers: [], incomplete: false }),
}));

import { POST } from './route';

const SECRET = 'test-internal-secret';
const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

function makePublicClient() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          if (table === 'merchants') {
            return {
              maybeSingle: () =>
                Promise.resolve({ data: { slug: 'ogabassey' }, error: null }),
            };
          }
          return {
            in: () =>
              Promise.resolve({
                data:
                  table === 'products'
                    ? [
                        {
                          id: 'prod-1',
                          slug: 'iphone-15',
                          category: 'smartphones',
                          categories: null,
                          product_categories: [],
                        },
                      ]
                    : [],
                error: null,
              }),
          };
        },
      }),
    }),
  };
}

function makeWorkStore(
  onRevalidateTag: (tags: string | string[]) => Promise<void>
): WorkStore {
  return {
    page: '/api/internal/revalidate-products/route',
    route: '/api/internal/revalidate-products',
    cacheLifeProfiles: {
      default: { stale: 300, revalidate: 900, expire: 86400 },
    },
    useCacheTimeout: 0,
    durableUseCacheEntries: false,
    staticPageGenerationTimeout: 60,
    incrementalCache: {
      revalidateTag: onRevalidateTag,
    },
  } as unknown as WorkStore;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    'https://app.usebaci.com/api/internal/revalidate-products',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify(body),
    }
  );
}

describe('POST /api/internal/revalidate-products origin-before-edge ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInternalApiSecret.mockReturnValue(SECRET);
    mockCreatePublicClient.mockReturnValue(makePublicClient());
  });

  it('completes origin tag invalidation before confirmed product purge so an immediate edge miss cannot restore stale pages', async () => {
    const staleOriginTags = new Set([
      `products-${MERCHANT_ID}`,
      `category-page-data-${MERCHANT_ID}`,
      `product-${MERCHANT_ID}-iphone-15`,
    ]);
    let edgeCategoryPage: 'stale' | 'fresh' = 'stale';

    const workStore = makeWorkStore(async (tags) => {
      for (const tag of Array.isArray(tags) ? tags : [tags]) {
        staleOriginTags.delete(tag);
      }
    });

    mockPurgeStorefrontProductConfirmed.mockImplementationOnce(async () => {
      // Simulate Cloudflare eviction followed immediately by a visitor miss
      // reaching origin while POST is still running.
      edgeCategoryPage = staleOriginTags.has(`products-${MERCHANT_ID}`)
        ? 'stale'
        : 'fresh';
      return true;
    });

    const res = await workAsyncStorage.run(workStore, () =>
      POST(
        makeRequest({
          merchantId: MERCHANT_ID,
          merchantSlug: 'ogabassey',
          expireProductBlogCache: true,
          confirmEdgeEviction: true,
          products: [{ slug: 'iphone-15', categorySlug: 'smartphones' }],
        })
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, edgePurged: true });
    expect(edgeCategoryPage).toBe('fresh');
  });

  it('completes origin tag invalidation before confirmed hostname purge', async () => {
    const staleOriginTags = new Set([`products-${MERCHANT_ID}`]);
    let edgeCategoryPage: 'stale' | 'fresh' = 'stale';

    const workStore = makeWorkStore(async (tags) => {
      for (const tag of Array.isArray(tags) ? tags : [tags]) {
        staleOriginTags.delete(tag);
      }
    });

    mockPurgeStorefrontHostnameConfirmed.mockImplementationOnce(async () => {
      edgeCategoryPage = staleOriginTags.has(`products-${MERCHANT_ID}`)
        ? 'stale'
        : 'fresh';
      return true;
    });

    const res = await workAsyncStorage.run(workStore, () =>
      POST(
        makeRequest({
          merchantId: MERCHANT_ID,
          merchantSlug: 'ogabassey',
          expireProductBlogCache: true,
          confirmEdgeEviction: true,
          purgeWholeStorefront: true,
        })
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, edgePurged: true });
    expect(edgeCategoryPage).toBe('fresh');
  });

  it('returns edgePurged: false and skips Cloudflare purge when origin tag drain fails', async () => {
    const workStore = makeWorkStore(async () => {
      throw new Error('origin revalidation store unavailable');
    });

    const res = await workAsyncStorage.run(workStore, () =>
      POST(
        makeRequest({
          merchantId: MERCHANT_ID,
          merchantSlug: 'ogabassey',
          expireProductBlogCache: true,
          confirmEdgeEviction: true,
          purgeWholeStorefront: true,
        })
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, edgePurged: false });
    expect(mockPurgeStorefrontHostnameConfirmed).not.toHaveBeenCalled();
  });

  it('leaves scheduled mode queued for Next resolvePendingRevalidations', async () => {
    const incrementalRevalidateTag = vi.fn(async () => undefined);
    const workStore = makeWorkStore(incrementalRevalidateTag);

    const res = await workAsyncStorage.run(workStore, () =>
      POST(
        makeRequest({
          merchantId: MERCHANT_ID,
          merchantSlug: 'ogabassey',
          expireProductBlogCache: true,
          products: [{ slug: 'iphone-15', categorySlug: 'smartphones' }],
        })
      )
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(incrementalRevalidateTag).not.toHaveBeenCalled();
    expect(workStore.pendingRevalidatedTags?.length).toBeGreaterThan(0);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledTimes(1);
  });
});
