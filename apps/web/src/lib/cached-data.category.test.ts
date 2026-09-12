import { cacheLife, cacheTag } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedCategoryPageData,
  getCachedCategoryPageShellData,
} from '@/lib/cached-data';
import {
  buildCachedDataTestHarness,
  type CachedDataTestHarness,
  resetMockCreateClient,
} from '@/lib/cached-data.test-utils';
import { getCategoryPageDataCacheTag } from '@/lib/category-page-cache-tags';
import { StorefrontReadUnavailableError } from '@/lib/storefront-read-result';

vi.mock('@/env', () => ({
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'test-anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'test-service-role-key'),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('react', () => ({ cache: vi.fn((fn) => fn) }));
vi.mock('@supabase/supabase-js', async () => {
  const { getMockCreateClient } = await import('@/lib/cached-data.test-utils');
  return {
    createClient: (...args: unknown[]) => {
      const createClient = getMockCreateClient();
      if (!createClient) {
        return {
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: vi.fn(),
                single: vi.fn(),
                eq: vi.fn(),
              }),
            }),
          }),
          auth: { getUser: vi.fn() },
        };
      }
      return createClient(...args);
    },
  };
});

let harness: CachedDataTestHarness;

beforeEach(() => {
  harness = buildCachedDataTestHarness();
});

afterEach(() => {
  resetMockCreateClient();
  vi.restoreAllMocks();
});

describe('getCachedCategoryPageData category routing and fallback logic', () => {
  it('Scenario 1: bypasses legacy fallback product queries and returns isInactiveCategory=true when get_storefront_category_slug_state RPC returns inactive slug state', async () => {
    // categories.single returns PGRST116 (not found)
    harness.mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });
    // RPC get_storefront_category_slug_state returns is_active: false
    harness.mockRpc.mockResolvedValueOnce({
      data: [{ is_active: false }],
      error: null,
    });

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'inactive-slug',
      'test-store'
    );

    // Assert RPC was called to inspect inactive state
    expect(harness.mockRpc).toHaveBeenCalledWith(
      'get_storefront_category_slug_state',
      {
        p_merchant_id: 'merchant-123',
        p_slug: 'inactive-slug',
      }
    );

    // Ensure the products table query was NOT executed
    expect(harness.mockFrom).not.toHaveBeenCalledWith('products');

    // Assert final result structure matches expected bypass state
    expect(result).toEqual({
      isCollection: false,
      category: null,
      products: [],
      fallbackName: 'Inactive Slug',
      fallbackDescription: 'Browse our collection of Inactive Slug products.',
      isInactiveCategory: true,
      productCount: 0,
      // "No rows" (PGRST116) is the expected unknown-slug path, not a failure.
      productsQueryFailed: false,
      categoryQueryFailed: false,
    });
  });

  it('Scenario 2: returns category with empty products without executing the legacy loose fallback search when canonical category exists but scoped query returns zero products', async () => {
    // 1. categories.single returns a valid active category
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });

    // categories scope query mock (returns its own ID)
    harness.mockListResult.data = [{ id: 'cat-active-123' }];

    // Mock scoped products query to return empty array
    const emptyScopedProductsResult = { data: [], error: null };
    harness.mockQueryExecution
      .mockImplementationOnce(() => Promise.resolve(harness.mockListResult)) // scope query execution
      .mockImplementationOnce(() => Promise.resolve(emptyScopedProductsResult)); // products query execution

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store'
    );

    // Verify it scoped products by categories in list
    expect(harness.mockIn).toHaveBeenCalledWith(
      'product_categories.category_id',
      ['cat-active-123']
    );

    // Ensure it did NOT run the legacy fallback ilike queries on products
    expect(harness.mockOr).toHaveBeenCalledOnce();
    expect(harness.mockOr).toHaveBeenCalledWith(
      'id.eq.cat-active-123,parent_id.eq.cat-active-123'
    );

    // Verify output returned the category correctly and products are empty
    expect(result).toEqual({
      isCollection: false,
      category: expect.objectContaining({
        id: 'cat-active-123',
        name: 'Active Category',
      }),
      products: [],
      fallbackName: 'Active Category',
      fallbackDescription: 'Standard active category',
      isInactiveCategory: false,
      productCount: 0,
      productsQueryFailed: false,
      categoryQueryFailed: false,
    });
  });

  it('applies category/product cache scopes while resolving category products', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null },
      { data: [{ id: 'product-1' }], error: null },
      { data: [{ id: 'product-1', name: 'Scoped Product' }], error: null }
    );

    await getCachedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store'
    );

    expect(cacheLife).toHaveBeenCalledWith('storefront-page');
    expect(cacheLife).toHaveBeenCalledWith('products');
    expect(cacheTag).toHaveBeenCalledWith(
      'category-page-data',
      'products',
      'categories',
      'products-merchant-123',
      'categories-merchant-123'
    );
    expect(cacheTag).toHaveBeenCalledWith(
      getCategoryPageDataCacheTag('merchant-123'),
      'products',
      'categories',
      'products-merchant-123',
      'categories-merchant-123'
    );
  });

  it('caps the category product-ID list so the local cache item stays bounded (PR4b)', () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null }, // scope resolution
      { data: [{ id: 'product-1' }], error: null }, // product-ID query
      { data: [{ id: 'product-1', name: 'Scoped Product' }], error: null }
    );

    return getCachedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store'
    ).then(() => {
      // Deterministic cap on the ordered UUID list; a broad category can return
      // 100s-1000s of IDs and must not grow the cache item unbounded.
      expect(harness.mockLimit).toHaveBeenCalledWith(2000);
    });
  });

  it('reports the exact product count when the category exceeds the ID cap (PR4b pagination truth)', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    const cappedIds = Array.from({ length: 2000 }, (_, index) => ({
      id: `product-${index}`,
    }));
    const firstPageWindow = cappedIds.slice(0, 20);
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null }, // scope resolution
      { data: cappedIds, error: null }, // capped ID query (hits the cap)
      { data: null, error: null, count: 2500 }, // exact head-count query
      {
        data: firstPageWindow.map(({ id }) => ({ id, name: `Product ${id}` })),
        error: null,
      } // detail chunk for the requested window
    );

    const getBoundedCategoryPageData = getCachedCategoryPageData as unknown as (
      merchantId: string,
      categorySlug: string,
      storeSlug: string,
      productOffset: number,
      productLimit: number
    ) => ReturnType<typeof getCachedCategoryPageData>;
    const result = await getBoundedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store',
      0,
      20
    );

    // productCount must come from the exact COUNT, not the truncated ID list,
    // so totalPages stays truthful for categories larger than the cap.
    expect(result).toMatchObject({
      productCount: 2500,
      productsArePrePaginated: true,
      productsQueryFailed: false,
    });
    expect(result.products).toHaveLength(20);
    // The in-window page is served from the cached ID list — no ranged query.
    expect(harness.mockRange).not.toHaveBeenCalled();
  });

  it('reports the exact count even when the server max-rows clamp returns fewer rows than the cap (PR4b r2)', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    // Supabase max-rows (managed default 1,000 — not overridden in
    // supabase/config.toml) clamps the response BELOW the 2,000 cap, so a
    // `length === CAP` gate would never fire and the truncated length would
    // silently masquerade as the total. The exact count must ALWAYS run.
    const clampedIds = Array.from({ length: 1000 }, (_, index) => ({
      id: `product-${index}`,
    }));
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null }, // scope resolution
      { data: clampedIds, error: null }, // ID query clamped by max-rows
      { data: null, error: null, count: 1367 }, // exact head-count query
      {
        data: clampedIds
          .slice(0, 20)
          .map(({ id }) => ({ id, name: `Product ${id}` })),
        error: null,
      } // detail chunk for the requested window
    );

    const getBoundedCategoryPageData = getCachedCategoryPageData as unknown as (
      merchantId: string,
      categorySlug: string,
      storeSlug: string,
      productOffset: number,
      productLimit: number
    ) => ReturnType<typeof getCachedCategoryPageData>;
    const result = await getBoundedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store',
      0,
      20
    );

    expect(result).toMatchObject({
      productCount: 1367,
      productsArePrePaginated: true,
      productsQueryFailed: false,
    });
  });

  it('assembles the FULL ID list per-request for unbounded consumers past the cached list (PR4b r2)', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    // No-limit consumers (price-band page, LLM category markdown) expect the
    // COMPLETE category payload. The cached list stays clamped/capped; the
    // remainder must be assembled per-request with the same ordering.
    const cachedIds = Array.from({ length: 1000 }, (_, index) => ({
      id: `product-${index}`,
    }));
    const tailIds = Array.from({ length: 10 }, (_, index) => ({
      id: `product-${1000 + index}`,
    }));
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null }, // scope resolution
      { data: cachedIds, error: null }, // clamped cached ID query
      { data: null, error: null, count: 1010 }, // exact head-count query
      { data: tailIds, error: null } // assembly window (1000..1999 → 10 rows)
      // detail chunks intentionally fall through to the harness default
      // ({ data: [], error: null }) — coverage is asserted via .in('id', …).
    );

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store'
    );

    // The assembly loop fetched the remainder with the shared ordering.
    expect(harness.mockRange).toHaveBeenCalledWith(1000, 1999);
    // Every one of the 1,010 IDs (cached + assembled) reached a detail chunk.
    const detailChunkIds = harness.mockIn.mock.calls
      .filter((call) => call[0] === 'id')
      .flatMap((call) => call[1] as string[]);
    expect(new Set(detailChunkIds).size).toBe(1010);
    expect(result.productsArePrePaginated).toBeUndefined();
    expect(result).toMatchObject({ productsQueryFailed: false });
  });

  it('serves pages beyond the capped ID window from a direct ranged query, not a 404 (PR4b)', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    const cappedIds = Array.from({ length: 2000 }, (_, index) => ({
      id: `product-${index}`,
    }));
    const tailWindow = Array.from({ length: 20 }, (_, index) => ({
      id: `product-${2480 + index}`,
    }));
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null }, // scope resolution
      { data: cappedIds, error: null }, // capped ID query (hits the cap)
      { data: null, error: null, count: 2500 }, // exact head-count query
      { data: tailWindow, error: null }, // direct ranged ID window query
      {
        data: tailWindow.map(({ id }) => ({ id, name: `Product ${id}` })),
        error: null,
      } // detail chunk for the tail window
    );

    const getBoundedCategoryPageData = getCachedCategoryPageData as unknown as (
      merchantId: string,
      categorySlug: string,
      storeSlug: string,
      productOffset: number,
      productLimit: number
    ) => ReturnType<typeof getCachedCategoryPageData>;
    const result = await getBoundedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store',
      2480,
      20
    );

    // The requested window extends beyond the cached (capped) ID list, so the
    // window is fetched directly with the same deterministic ordering.
    expect(harness.mockRange).toHaveBeenCalledWith(2480, 2499);
    expect(result).toMatchObject({
      productCount: 2500,
      productsArePrePaginated: true,
      productsQueryFailed: false,
    });
    expect(result.products).toHaveLength(20);
  });

  it('degrades an ID query failure outside the remote cache without treating it as an empty catalog', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null },
      {
        data: null,
        error: { code: '57014', message: 'statement timeout' },
      }
    );

    // BOUNDED read (PR4b review r6): fail-OPEN flags are the PAGINATED contract
    // — the route uses productIdsQueryFailed to avoid mistaking an outage for a
    // real empty category. The unbounded path is all-or-nothing and now THROWS
    // on an ID-query failure instead of publishing an empty catalogue (which
    // would 404 a valid category); see the parametrized per-leg suite.
    const getBoundedCategoryPageData = getCachedCategoryPageData as unknown as (
      merchantId: string,
      categorySlug: string,
      storeSlug: string,
      productOffset: number,
      productLimit: number
    ) => ReturnType<typeof getCachedCategoryPageData>;
    const result = await getBoundedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store',
      0,
      20
    );

    expect(result).toMatchObject({
      categoryQueryFailed: false,
      productIdsQueryFailed: true,
      products: [],
      productsQueryFailed: true,
    });
  });

  it('keeps the fetched catalog when only the supplementary count query fails (PR4b review r4)', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    const productIds = Array.from({ length: 49 }, (_, index) => ({
      id: `product-${index + 1}`,
    }));
    const firstPageWindow = productIds.slice(0, 20);
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null }, // scope resolution
      { data: productIds, error: null }, // ID window query SUCCEEDS
      {
        data: null,
        error: { code: '57014', message: 'statement timeout' },
        count: null,
      }, // supplementary exact head-count query FAILS
      {
        data: firstPageWindow.map(({ id }) => ({
          id,
          name: `Product ${id}`,
          slug: id,
        })),
        error: null,
      } // detail chunk for the requested window
    );

    const getBoundedCategoryPageData = getCachedCategoryPageData as unknown as (
      merchantId: string,
      categorySlug: string,
      storeSlug: string,
      productOffset: number,
      productLimit: number
    ) => ReturnType<typeof getCachedCategoryPageData>;
    const result = await getBoundedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store',
      0,
      20
    );

    // The COUNT is SUPPLEMENTARY, the ID list is CORE. A failed count must
    // degrade the TOTALS only — never discard a catalog that fetched fine.
    expect(result.products).toHaveLength(20);
    expect(result).toMatchObject({
      // Falls back to the successfully-fetched ID-list length, so totalPages
      // stays derivable instead of collapsing the page to an empty catalog.
      productCount: 49,
      productsArePrePaginated: true,
      productsQueryFailed: false,
    });
    // The ID query did NOT fail, so consumers must not fail open / 404.
    expect(result.productIdsQueryFailed).toBeUndefined();
  });

  // NOTE: the round-4 test "serves the whole cached ID list to unbounded
  // consumers when the count query fails" was RETIRED in round 5. It asserted
  // that NO ranged query runs when the count is unverified — but serving the
  // cached prefix as though it were the whole catalogue is precisely the
  // partial-payload lie Codex flagged (PRRT_kwDOQZgfis6Qj8vl). Unbounded reads
  // now probe past the list to PROVE completeness, so its scenario is
  // superseded by "serves the cached list to unbounded consumers when it is
  // provably complete despite an unverified count" below.

  it('probes the requested deep-page range when the count is unverified, instead of 404ing it (PR4b review r5)', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    // Cached list is clamped to 50; the real category is much larger.
    const cachedIds = Array.from({ length: 50 }, (_, index) => ({
      id: `product-${index + 1}`,
    }));
    const probedWindow = Array.from({ length: 20 }, (_, index) => ({
      id: `product-${index + 61}`,
    }));
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null }, // scope resolution
      { data: cachedIds, error: null }, // ID query SUCCEEDS (clamped to 50)
      {
        data: null,
        error: { code: '57014', message: 'statement timeout' },
        count: null,
      }, // count query FAILS → totals unverified
      { data: probedWindow, error: null }, // .range(60,79) probe → rows EXIST
      {
        data: probedWindow.map(({ id }) => ({ id, name: `Product ${id}` })),
        error: null,
      } // detail chunk
    );

    const getBoundedCategoryPageData = getCachedCategoryPageData as unknown as (
      merchantId: string,
      categorySlug: string,
      storeSlug: string,
      productOffset: number,
      productLimit: number
    ) => ReturnType<typeof getCachedCategoryPageData>;
    const result = await getBoundedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store',
      60,
      20
    );

    // The page is VALID: the probe proved rows exist at this offset. An
    // unverified total must never turn a real deep page into a hard 404.
    expect(harness.mockRange).toHaveBeenCalledWith(60, 79);
    expect(result.products).toHaveLength(20);
    // The pagination floor must cover the served window (offset + rows), or the
    // route computes currentPage > totalPages and 404s the page we just served.
    expect(result.productCount).toBeGreaterThanOrEqual(80);
    expect(result.productIdsQueryFailed).toBeUndefined();
  });

  it('never emits a confident 404 when the count is unverified and the probe finds no rows (PR4b review r5)', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    const cachedIds = Array.from({ length: 50 }, (_, index) => ({
      id: `product-${index + 1}`,
    }));
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null },
      { data: cachedIds, error: null },
      {
        data: null,
        error: { code: '57014', message: 'statement timeout' },
        count: null,
      }, // count FAILS → totals unverified
      { data: [], error: null } // probe finds no rows — but we CANNOT prove out-of-range
    );

    const getBoundedCategoryPageData = getCachedCategoryPageData as unknown as (
      merchantId: string,
      categorySlug: string,
      storeSlug: string,
      productOffset: number,
      productLimit: number
    ) => ReturnType<typeof getCachedCategoryPageData>;
    const result = await getBoundedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store',
      60,
      20
    );

    // Zero rows + an UNVERIFIED total is not proof the page is out of range.
    // Signal uncertainty via the existing fail-open flag so the route renders a
    // 200 (noindex) instead of a hard 404 on an unverified total.
    expect(result.productIdsQueryFailed).toBe(true);
    expect(result.products).toEqual([]);
  });

  it('still reports a genuinely out-of-range page when the count is exact (PR4b review r5)', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    const cachedIds = Array.from({ length: 50 }, (_, index) => ({
      id: `product-${index + 1}`,
    }));
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null },
      { data: cachedIds, error: null },
      { data: null, error: null, count: 50 } // EXACT count — list is complete
    );

    const getBoundedCategoryPageData = getCachedCategoryPageData as unknown as (
      merchantId: string,
      categorySlug: string,
      storeSlug: string,
      productOffset: number,
      productLimit: number
    ) => ReturnType<typeof getCachedCategoryPageData>;
    const result = await getBoundedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store',
      60,
      20
    );

    // The total is PROVEN (50) and the offset is past it — a real 404. No probe
    // needed, and the fail-open flag must stay off so the route can 404.
    expect(harness.mockRange).not.toHaveBeenCalled();
    expect(result.products).toEqual([]);
    expect(result.productCount).toBe(50);
    expect(result.productIdsQueryFailed).toBeUndefined();
  });

  // Unbounded consumers (price-band page, LLM category markdown) publish the
  // payload as the COMPLETE catalogue and do not check productsQueryFailed, so
  // they must receive the whole catalogue or an explicit failure — never a
  // truncated prefix passed off as the full inventory (PR4b review r5).
  const buildActiveCategoryRow = () => ({
    data: {
      id: 'cat-active-123',
      name: 'Active Category',
      slug: 'active-category',
      description: 'Standard active category',
      image_url: null,
      is_active: true,
      seo_heading: null,
      seo_description: null,
      seo_features: null,
      seo_faq: null,
      parent: null,
    },
    error: null,
  });

  it('throws rather than serving a truncated catalogue when the unbounded tail assembly fails (PR4b review r5)', async () => {
    harness.mockSingle.mockResolvedValueOnce(buildActiveCategoryRow());
    const cachedIds = Array.from({ length: 50 }, (_, index) => ({
      id: `product-${index + 1}`,
    }));
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null },
      { data: cachedIds, error: null }, // clamped prefix
      { data: null, error: null, count: 2500 }, // EXACT count — 2450 more exist
      {
        data: null,
        error: { code: '57014', message: 'statement timeout' },
      } // tail assembly window FAILS
    );

    // Must NOT resolve with the 50-item prefix — that would publish an
    // incomplete price-band / markdown inventory as if it were the catalogue.
    await expect(
      getCachedCategoryPageData('merchant-123', 'active-category', 'test-store')
    ).rejects.toBeInstanceOf(StorefrontReadUnavailableError);
  });

  it('throws when the unbounded tail probe fails and the count is unverified (PR4b review r5)', async () => {
    harness.mockSingle.mockResolvedValueOnce(buildActiveCategoryRow());
    const cachedIds = Array.from({ length: 30 }, (_, index) => ({
      id: `product-${index + 1}`,
    }));
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null },
      { data: cachedIds, error: null },
      {
        data: null,
        error: { code: '57014', message: 'statement timeout' },
        count: null,
      }, // count FAILS
      {
        data: null,
        error: { code: '57014', message: 'statement timeout' },
      } // completeness probe ALSO fails → completeness unprovable
    );

    await expect(
      getCachedCategoryPageData('merchant-123', 'active-category', 'test-store')
    ).rejects.toBeInstanceOf(StorefrontReadUnavailableError);
  });

  it('recovers the COMPLETE catalogue by paging when the count is unverified (PR4b review r5)', async () => {
    harness.mockSingle.mockResolvedValueOnce(buildActiveCategoryRow());
    const cachedIds = Array.from({ length: 30 }, (_, index) => ({
      id: `product-${index + 1}`,
    }));
    const tail = Array.from({ length: 10 }, (_, index) => ({
      id: `product-${index + 31}`,
    }));
    const completeIds = [...cachedIds, ...tail];
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null },
      { data: cachedIds, error: null },
      {
        data: null,
        error: { code: '57014', message: 'statement timeout' },
        count: null,
      }, // count FAILS → no total to page toward
      { data: tail, error: null }, // short window → proves exhaustion
      {
        data: completeIds.map(({ id }) => ({ id, name: `Product ${id}` })),
        error: null,
      } // single detail chunk (40 <= CATEGORY_PAGE_PRODUCT_DETAIL_CHUNK_SIZE)
    );

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store'
    );

    // Paging to exhaustion recovers the full catalogue even with no count.
    expect(result.products).toHaveLength(40);
    expect(result.productsQueryFailed).toBe(false);
  });

  it('serves the cached list to unbounded consumers when it is provably complete despite an unverified count (PR4b review r5)', async () => {
    harness.mockSingle.mockResolvedValueOnce(buildActiveCategoryRow());
    const cachedIds = Array.from({ length: 30 }, (_, index) => ({
      id: `product-${index + 1}`,
    }));
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null },
      { data: cachedIds, error: null },
      {
        data: null,
        error: { code: '57014', message: 'statement timeout' },
        count: null,
      }, // count FAILS
      { data: [], error: null }, // probe past the list finds nothing → PROVABLY complete
      {
        data: cachedIds.map(({ id }) => ({ id, name: `Product ${id}` })),
        error: null,
      }
    );

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store'
    );

    expect(result.products).toHaveLength(30);
    expect(result.productsQueryFailed).toBe(false);
  });

  // STRUCTURAL INVARIANT (PR4b review r6): unbounded reads are all-or-nothing.
  //
  // The r5 contract was wired to ONE failure leg (tail assembly), so the ID-list
  // and detail-chunk legs still leaked truncated catalogues to the unbounded
  // consumers. The guard now lives at a SINGLE exit point and is exhaustive over
  // a failure-signal record, so a new leg cannot silently skip it.
  //
  // This suite is parametrized per leg on purpose: add a failure leg, add a case
  // here, and a leg that forgets to funnel through the guard fails the suite.
  describe('unbounded catalogue reads are all-or-nothing (PR4b review r6)', () => {
    const activeCategoryRow = () => ({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    const scopeRow = { data: [{ id: 'cat-active-123' }], error: null };
    const transientError = {
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    };
    const ids = (count: number, offset = 0) =>
      Array.from({ length: count }, (_, index) => ({
        id: `product-${index + 1 + offset}`,
      }));

    // Each case drives ONE failure leg of the unbounded path.
    const failureLegs: Array<{
      leg: string;
      results: Record<string, unknown>[];
    }> = [
      {
        // Leg: the CORE ordered-ID read fails. Previously collapsed to an empty
        // ID list → empty catalogue → the LLM route 404s a VALID category,
        // deindexing it on a transient blip.
        leg: 'product ID query',
        results: [scopeRow, transientError],
      },
      {
        // Leg: the exact-count read fails AND the completeness probe fails, so
        // completeness is unprovable.
        leg: 'completeness probe',
        results: [
          scopeRow,
          { data: ids(30), error: null },
          { ...transientError, count: null },
          transientError,
        ],
      },
      {
        // Leg: the full-catalogue tail assembly fails past the cached prefix.
        leg: 'tail assembly',
        results: [
          scopeRow,
          { data: ids(50), error: null },
          { data: null, error: null, count: 2500 },
          transientError,
        ],
      },
      {
        // Leg: a product-DETAIL chunk fails. Previously reduced to a flag while
        // returning the successfully-loaded chunks → a TRUNCATED catalogue was
        // published as the complete one.
        leg: 'product detail chunk',
        results: [
          scopeRow,
          { data: ids(30), error: null },
          { data: null, error: null, count: 30 },
          transientError,
        ],
      },
    ];

    it.each(
      failureLegs
    )('throws StorefrontReadUnavailableError when the $leg fails', async ({
      results,
    }) => {
      harness.mockSingle.mockResolvedValueOnce(activeCategoryRow());
      harness.mockListResults.push(...(results as never[]));

      await expect(
        getCachedCategoryPageData(
          'merchant-123',
          'active-category',
          'test-store'
        )
      ).rejects.toBeInstanceOf(StorefrontReadUnavailableError);
    });

    it.each(
      failureLegs
    )('keeps BOUNDED reads failing open (not throwing) when the $leg fails', async ({
      results,
    }) => {
      harness.mockSingle.mockResolvedValueOnce(activeCategoryRow());
      harness.mockListResults.push(...(results as never[]));

      const getBounded = getCachedCategoryPageData as unknown as (
        merchantId: string,
        categorySlug: string,
        storeSlug: string,
        productOffset: number,
        productLimit: number
      ) => ReturnType<typeof getCachedCategoryPageData>;

      // The paginated storefront page may degrade gracefully; only the
      // crawler/feed consumers fail closed. A bounded read must never throw.
      const result = await getBounded(
        'merchant-123',
        'active-category',
        'test-store',
        0,
        20
      );
      expect(result).toBeDefined();
    });
  });

  it('preserves ID slots when an early detail chunk fails and a later chunk succeeds', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });

    const productIds = Array.from({ length: 49 }, (_, index) => ({
      id: `product-${index + 1}`,
    }));
    harness.mockListResults.push(
      { data: [{ id: 'cat-active-123' }], error: null },
      { data: productIds, error: null },
      { data: null, error: null, count: 49 }, // exact head-count (always runs)
      { data: [], error: { message: 'detail timeout' } },
      {
        data: [
          {
            id: 'product-49',
            name: 'Recovered Product',
            slug: 'recovered-product',
          },
        ],
        error: null,
      }
    );

    // BOUNDED read (PR4b review r6): slot-preserving degradation is the
    // PAGINATED contract. The unbounded path is all-or-nothing and now throws on
    // a detail-chunk failure rather than publishing a truncated catalogue —
    // covered by the parametrized per-leg suite above.
    const getBoundedCategoryPageData = getCachedCategoryPageData as unknown as (
      merchantId: string,
      categorySlug: string,
      storeSlug: string,
      productOffset: number,
      productLimit: number
    ) => ReturnType<typeof getCachedCategoryPageData>;
    const result = await getBoundedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store',
      0,
      49
    );

    expect(result.productsQueryFailed).toBe(true);
    expect(result.products).toEqual([
      expect.objectContaining({ id: 'product-49' }),
    ]);
    expect(result.productSlots).toHaveLength(49);
    expect(result.productSlots?.slice(0, 48)).toEqual(
      Array.from({ length: 48 }, () => null)
    );
    expect(result.productSlots?.[48]).toEqual(
      expect.objectContaining({ id: 'product-49' })
    );
  });

  it('filters detail relations to the scoped category IDs', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-parent',
        name: 'Phones',
        slug: 'phones',
        description: 'Phones',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });

    harness.mockListResults.push(
      { data: [{ id: 'cat-parent' }, { id: 'cat-child' }], error: null },
      { data: [{ id: 'product-1' }], error: null },
      { data: null, error: null, count: 1 }, // exact head-count (always runs)
      { data: [{ id: 'product-1', name: 'Scoped Product' }], error: null }
    );

    await getCachedCategoryPageData('merchant-123', 'phones', 'test-store');

    expect(harness.mockIn).toHaveBeenCalledWith(
      'product_categories.category_id',
      ['cat-parent', 'cat-child']
    );
    // ID query + exact head-count query + detail query are all category-scoped.
    expect(
      harness.mockIn.mock.calls.filter(
        ([column]) => column === 'product_categories.category_id'
      )
    ).toHaveLength(3);
    const detailSelect = harness.mockSelect.mock.calls
      .map(([select]) => String(select))
      .find(
        (select) =>
          select.includes('manage_stock') &&
          select.includes('categories(name, slug)')
      );
    expect(detailSelect).toContain('product_categories!inner');
  });

  it('drops missing detail rows from known pagination slots when the ID list is stale', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-parent',
        name: 'Phones',
        slug: 'phones',
        description: 'Phones',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });

    const productIds = Array.from({ length: 21 }, (_, index) => ({
      id: `product-${index + 1}`,
    }));
    const returnedProducts = productIds.slice(0, 20).map(({ id }) => ({
      id,
      name: `Product ${id}`,
      slug: id,
    }));
    harness.mockListResults.push(
      { data: [{ id: 'cat-parent' }], error: null },
      { data: productIds, error: null },
      { data: null, error: null, count: 21 }, // exact head-count (always runs)
      { data: returnedProducts, error: null }
    );

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'phones',
      'test-store'
    );

    expect(result.productsQueryFailed).toBe(false);
    expect(result.products).toHaveLength(20);
    expect(result.productSlots).toBeUndefined();
  });

  it('fetches only the requested detail ID window while preserving total product count', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-parent',
        name: 'Phones',
        slug: 'phones',
        description: 'Phones',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });

    const productIds = Array.from({ length: 49 }, (_, index) => ({
      id: `product-${index + 1}`,
    }));
    const requestedWindow = productIds.slice(20, 40);
    harness.mockListResults.push(
      { data: [{ id: 'cat-parent' }], error: null },
      { data: productIds, error: null },
      { data: null, error: null, count: 49 }, // exact head-count (always runs)
      {
        data: requestedWindow.map(({ id }) => ({
          id,
          name: `Product ${id}`,
          slug: id,
        })),
        error: null,
      }
    );

    const getBoundedCategoryPageData = getCachedCategoryPageData as unknown as (
      merchantId: string,
      categorySlug: string,
      storeSlug: string,
      productOffset: number,
      productLimit: number
    ) => ReturnType<typeof getCachedCategoryPageData>;
    const result = await getBoundedCategoryPageData(
      'merchant-123',
      'phones',
      'test-store',
      20,
      20
    );

    expect(harness.mockIn).toHaveBeenCalledWith(
      'id',
      requestedWindow.map(({ id }) => id)
    );
    expect(result.products).toHaveLength(20);
    expect(result).toMatchObject({
      productCount: 49,
      productsArePrePaginated: true,
    });
  });

  it('Scenario 3: flags categoryQueryFailed (fail open) when the category .single() lookup hits a transient error, not a normal "no rows"', async () => {
    // A non-PGRST116 error means we could not confirm the slug is unknown — the
    // doorway-trap guard must fail open rather than noindex a possibly-live page.
    harness.mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: '57014', message: 'canceling statement due to timeout' },
    });
    // No hidden state. A transient category read must keep the product scope
    // empty rather than broadening into the legacy fuzzy search.
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'maybe-real',
      'test-store'
    );

    expect(result).toEqual(
      expect.objectContaining({
        category: null,
        isInactiveCategory: false,
        categoryQueryFailed: true,
        products: [],
        productsQueryFailed: true,
      })
    );
    expect(harness.mockFrom).not.toHaveBeenCalledWith('products');
  });

  it('keeps transient category-row errors outside the cached shell result', async () => {
    const categoryError = {
      code: '57014',
      message: 'canceling statement due to timeout',
    };
    harness.mockSingle.mockResolvedValueOnce({
      data: null,
      error: categoryError,
    });

    await expect(
      getCachedCategoryPageShellData('merchant-123', 'maybe-real')
    ).rejects.toBe(categoryError);
  });

  it('keeps transient child-scope errors outside the cached shell result', async () => {
    const scopeError = {
      code: '57014',
      message: 'category scope timed out',
    };
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    harness.mockQueryExecution.mockReturnValueOnce({
      data: null,
      error: scopeError,
    });

    await expect(
      getCachedCategoryPageShellData('merchant-123', 'active-category')
    ).rejects.toBe(scopeError);
  });

  it('does not broaden a known category after a transient child-scope failure', async () => {
    const scopeError = {
      code: '57014',
      message: 'category scope timed out',
    };
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-active-123',
        name: 'Active Category',
        slug: 'active-category',
        description: 'Standard active category',
        image_url: null,
        is_active: true,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });
    harness.mockQueryExecution.mockReturnValueOnce({
      data: null,
      error: scopeError,
    });

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'active-category',
      'test-store'
    );

    expect(result).toMatchObject({
      category: null,
      categoryQueryFailed: true,
      products: [],
      productsQueryFailed: true,
    });
    expect(harness.mockFrom).not.toHaveBeenCalledWith('products');
  });
});
