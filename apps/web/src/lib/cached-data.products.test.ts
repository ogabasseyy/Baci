import { cacheTag } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedCategoryPageData,
  getCachedCategoryPageGraphicsOptions,
  getCachedLegacyProductRedirectTarget,
  getCachedProductCanonicalRedirectTarget,
  getCachedProductLcpHint,
  getCachedProducts,
  getCachedProductWithDetails,
} from '@/lib/cached-data';
import {
  buildCachedDataTestHarness,
  type CachedDataTestHarness,
  resetMockCreateClient,
} from '@/lib/cached-data.test-utils';
import { getProductScopedCacheTag } from '@/lib/product-cache-tags';
import {
  getPublicSerializedVariantSummariesByProductId,
  type PublicSerializedVariantSummary,
} from '@/lib/public-serialized-variant-summary';

vi.mock('@/env', () => ({
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'test-anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'test-service-role-key'),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('react', () => ({ cache: vi.fn((fn) => fn) }));
vi.mock('@/lib/public-serialized-variant-summary', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/public-serialized-variant-summary')
  >('@/lib/public-serialized-variant-summary');

  return {
    ...actual,
    getPublicSerializedVariantSummariesByProductId: vi.fn(() =>
      Promise.resolve([])
    ),
  };
});
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

describe('cached-data product query projections', () => {
  const singleProduct = {
    id: 'product-123',
    slug: 'iphone-16',
    variant_attributes: { storage: ['128GB'] },
  };
  const productList = [
    { id: 'product-123', slug: 'iphone-16' },
    { id: 'product-456', slug: 'iphone-15' },
  ];
  const singleProductResult = { data: singleProduct, error: null };
  const productQueryError = {
    data: null,
    error: { message: 'db error', code: '42P01' },
  };
  const rpcFailure = {
    data: null,
    error: { message: 'RPC failed', code: 'P0001' },
  };
  const standaloneCurrencyColumnPattern = /(?:^|[\s,])currency\s*(?:,|\n|$)/;
  const standaloneQuantityColumnPattern = /(?:^|[\s,])quantity\s*(?:,|\n|$)/;
  const standaloneTrackQuantityColumnPattern =
    /(?:^|[\s,])track_quantity\s*(?:,|\n|$)/;
  const standaloneDescriptionColumnPattern =
    /(?:^|[\s,])description\s*(?:,|\n|$)/;
  const resolvedPdpSnapshot = (
    product: Record<string, unknown> = singleProduct
  ) => ({
    data: [
      {
        resolution_status: 'found',
        product_data: {
          categories: {
            id: 'category-123',
            name: 'Smartphones',
            slug: 'smartphones',
          },
          merchant_id: 'merchant-123',
          name: 'iPhone 16',
          price: 910000,
          product_key_specs: null,
          product_offers: [],
          product_variants: [],
          ...product,
        },
      },
    ],
    error: null,
    status: 200,
  });
  const missingPdpSnapshot = {
    data: [{ resolution_status: 'not_found', product_data: null }],
    error: null,
    status: 200,
  };

  it('getCachedProductLcpHint reads route, image, and variant data from one bounded snapshot', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedPdpSnapshot({
        ...singleProduct,
        brand: 'Apple',
        images: ['https://example.com/iphone.jpg'],
        price: 910000,
        product_variants: [
          {
            attributes: { storage: '128GB' },
            id: 'variant-1',
            product_id: 'product-123',
            stock_quantity: 2,
          },
        ],
      })
    );

    const result = await getCachedProductLcpHint('merchant-123', 'iphone-16');

    expect(harness.mockRpc).toHaveBeenCalledWith(
      'get_storefront_pdp_core_v2',
      {
        // p_branch_id omitted: null would GET-serialize to the literal
        // string 'null' and 22P02 the RPC (see storefront-pdp-core-snapshot).
        p_merchant_id: 'merchant-123',
        p_product_slug: 'iphone-16',
      },
      { get: true }
    );
    expect(harness.mockRpc).toHaveBeenCalledOnce();
    expect(harness.mockSelect).not.toHaveBeenCalled();
    expect(cacheTag).toHaveBeenCalledWith(
      'product',
      'product-lcp-hint',
      'products-merchant-123',
      getProductScopedCacheTag('product', 'merchant-123', 'iphone-16')
    );
    expect(cacheTag).toHaveBeenCalledWith(
      'product',
      'product-details',
      'product-lcp-hint',
      'products-merchant-123',
      'categories-merchant-123',
      getProductScopedCacheTag('product', 'merchant-123', 'iphone-16')
    );
    expect(result?.product_variants).toEqual([
      expect.objectContaining({
        attributes: { storage: '128GB' },
        id: 'variant-1',
      }),
    ]);
    expect(result?.variant_attributes).toEqual({ storage: ['128GB'] });
  });

  it('getCachedProductLcpHint preserves serialized public stock from the snapshot', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedPdpSnapshot({
        ...singleProduct,
        product_variants: [
          {
            attributes: { storage: '128GB' },
            id: 'variant-1',
            inventory_tracking_policy: 'serialized_then_unlimited',
            product_id: 'product-123',
            stock_quantity: 9999,
          },
        ],
      })
    );

    const result = await getCachedProductLcpHint('merchant-123', 'iphone-16');

    expect(result?.product_variants).toEqual([
      expect.objectContaining({
        id: 'variant-1',
        inventory_tracking_policy: 'serialized_then_unlimited',
        stock_quantity: 9999,
      }),
    ]);
    expect(
      getPublicSerializedVariantSummariesByProductId
    ).not.toHaveBeenCalled();
  });

  it('getCachedProductLcpHint omits snapshot variants for image-only callers', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedPdpSnapshot({
        ...singleProduct,
        product_variants: [{ id: 'variant-1', product_id: 'product-123' }],
      })
    );

    const result = await getCachedProductLcpHint('merchant-123', 'iphone-16', {
      includeVariants: false,
    });

    expect(result).not.toHaveProperty('product_variants');
    expect(harness.mockRpc).toHaveBeenCalledOnce();
  });

  it('getCachedProductLcpHint supports UUID-shaped product slugs as well as IDs', async () => {
    const uuidPath = 'ABCDEF12-3456-4789-ABCD-ABCDEF123456';
    harness.mockRpc.mockResolvedValueOnce(resolvedPdpSnapshot());

    await getCachedProductLcpHint('merchant-123', uuidPath);

    expect(harness.mockRpc).toHaveBeenCalledWith(
      'get_storefront_pdp_core_v2',
      {
        // p_branch_id omitted: null would GET-serialize to the literal
        // string 'null' and 22P02 the RPC (see storefront-pdp-core-snapshot).
        p_merchant_id: 'merchant-123',
        p_product_slug: uuidPath,
      },
      { get: true }
    );
  });

  it('getCachedProductWithDetails preserves UUID routes for products without a stored slug', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedPdpSnapshot({
        ...singleProduct,
        slug: null,
      })
    );

    await expect(
      getCachedProductWithDetails('merchant-123', 'product-123')
    ).resolves.toEqual(expect.objectContaining({ slug: 'product-123' }));
  });

  it('getCachedProductLcpHint throws on snapshot errors instead of caching false absence', async () => {
    harness.mockRpc.mockResolvedValueOnce({
      ...productQueryError,
      status: 500,
    });

    await expect(
      getCachedProductLcpHint('merchant-123', 'missing-product')
    ).rejects.toMatchObject({
      failure: {
        code: '42P01',
        operation: 'pdp_core_snapshot',
      },
    });
  });

  it('getCachedProductCanonicalRedirectTarget uses the narrow proxy preflight projection', async () => {
    harness.mockMaybeSingle.mockResolvedValueOnce(singleProductResult);

    await getCachedProductCanonicalRedirectTarget('merchant-123', 'iphone-16');

    expect(harness.mockEq).toHaveBeenCalledWith('merchant_id', 'merchant-123');
    expect(harness.mockEq).toHaveBeenCalledWith('slug', 'iphone-16');
    const selectArg = String(harness.mockSelect.mock.calls.at(-1)?.[0]);
    expect(selectArg).toContain('id');
    expect(selectArg).toContain('name');
    expect(selectArg).toContain('slug');
    expect(selectArg).toContain('status');
    expect(selectArg).toContain('category');
    expect(selectArg).not.toMatch(/\bcategory_slug\b/);
    expect(selectArg).toContain('canonical_url');
    expect(selectArg).toContain('categories:category_id');
    expect(selectArg).not.toMatch(/\*\s*,/);
    expect(selectArg).not.toMatch(standaloneDescriptionColumnPattern);
    expect(selectArg).not.toContain('product_key_specs');
    expect(selectArg).not.toContain('product_offers');
    expect(selectArg).not.toContain('product_variants');
    expect(cacheTag).toHaveBeenCalledWith(
      'product',
      'product-canonical-redirect',
      getProductScopedCacheTag('product', 'merchant-123', 'iphone-16'),
      getProductScopedCacheTag(
        'product-canonical-redirect',
        'merchant-123',
        'iphone-16'
      )
    );
    expect(harness.mockRpc).not.toHaveBeenCalled();
  });

  it('getCachedProductCanonicalRedirectTarget throws on query error', async () => {
    harness.mockMaybeSingle.mockResolvedValueOnce(productQueryError);

    await expect(
      getCachedProductCanonicalRedirectTarget('merchant-123', 'missing-product')
    ).rejects.toEqual(productQueryError.error);
  });

  it('getCachedProductWithDetails returns relations from the bounded snapshot', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedPdpSnapshot({
        ...singleProduct,
        fulfillmentFields: { imei: true },
        imageHint: 'phone on white background',
        product_key_specs: { has_ois: true },
        product_offers: [{ id: 'offer-1', status: 'active' }],
      })
    );

    const result = await getCachedProductWithDetails(
      'merchant-123',
      'iphone-16'
    );

    expect(result).toEqual(
      expect.objectContaining({
        fulfillmentFields: { imei: true },
        imageHint: 'phone on white background',
        product_key_specs: { has_ois: true },
        product_offers: [{ id: 'offer-1', status: 'active' }],
      })
    );
    expect(harness.mockRpc).toHaveBeenCalledOnce();
    expect(harness.mockSelect).not.toHaveBeenCalled();
  });

  it('uses ByteString-safe product cache tags for non-ASCII product slugs', async () => {
    const productSlug = 'dell-alienware-x14-r2-–-14”';
    harness.mockRpc.mockResolvedValueOnce(resolvedPdpSnapshot());

    await getCachedProductWithDetails('merchant-123', productSlug);

    const expectedTag = getProductScopedCacheTag(
      'product',
      'merchant-123',
      productSlug
    );
    expect(cacheTag).toHaveBeenCalledWith(
      'product',
      'product-details',
      expectedTag
    );
    expect(expectedTag).not.toContain('–');
    expect(expectedTag).not.toContain('”');
  });

  it('getCachedProducts attaches storefront variants from the public RPC', async () => {
    harness.mockListResult.data = productList;
    harness.mockListResult.error = null;
    harness.mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: 'variant-1',
          product_id: 'product-123',
          attributes: { storage: '128GB' },
          stock_quantity: 2,
        },
        {
          id: 'variant-2',
          product_id: 'product-456',
          attributes: { storage: '256GB' },
          stock_quantity: 1,
        },
      ],
      error: null,
    });

    await expect(getCachedProducts('merchant-123')).resolves.toEqual([
      expect.objectContaining({
        id: 'product-123',
        product_variants: [
          expect.objectContaining({
            id: 'variant-1',
            attributes: { storage: '128GB' },
          }),
        ],
      }),
      expect.objectContaining({
        id: 'product-456',
        product_variants: [
          expect.objectContaining({
            id: 'variant-2',
            attributes: { storage: '256GB' },
          }),
        ],
      }),
    ]);
    expect(harness.mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_variants',
      {
        p_product_ids: ['product-123', 'product-456'],
      }
    );
    expect(harness.mockQueryExecution.mock.invocationCallOrder[0]).toBeLessThan(
      harness.mockRpc.mock.invocationCallOrder[0]
    );
    expect(cacheTag).toHaveBeenCalledWith(
      'products',
      'product-variants',
      'products-merchant-123'
    );
    const selectArg = String(harness.mockSelect.mock.calls.at(-1)?.[0]);
    expect(selectArg).not.toMatch(standaloneCurrencyColumnPattern);
    expect(selectArg).not.toMatch(standaloneQuantityColumnPattern);
    expect(selectArg).not.toMatch(standaloneTrackQuantityColumnPattern);
    expect(selectArg).toContain('quantity:stock_quantity');
    expect(selectArg).toContain('track_quantity:manage_stock');
    expect(selectArg).not.toContain('is_featured');
  });

  it('getCachedProducts can skip storefront variant hydration for listing-only callers', async () => {
    harness.mockListResult.data = productList;
    harness.mockListResult.error = null;

    await expect(
      getCachedProducts('merchant-123', { includeVariants: false })
    ).resolves.toEqual([
      expect.objectContaining({ id: 'product-123', product_variants: [] }),
      expect.objectContaining({ id: 'product-456', product_variants: [] }),
    ]);
    expect(harness.mockRpc).not.toHaveBeenCalledWith(
      'get_storefront_product_variants',
      expect.any(Object)
    );
  });

  it('getCachedProducts does not filter by the retired is_featured column', async () => {
    harness.mockListResult.data = productList;
    harness.mockListResult.error = null;

    await getCachedProducts('merchant-123', { featured: true });

    expect(harness.mockEq).not.toHaveBeenCalledWith('is_featured', true);
  });

  it('getCachedProducts maps price fields to legacy base/sale fields', async () => {
    harness.mockListResult.data = [
      {
        id: 'product-123',
        slug: 'iphone-16',
        price: 950000,
        compare_at_price: 1000000,
      },
      {
        id: 'product-456',
        slug: 'iphone-15',
        price: 500000,
        compare_at_price: null,
      },
    ];
    harness.mockListResult.error = null;
    harness.mockRpc.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const result = await getCachedProducts('merchant-123');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'product-123',
        base_price: 1000000,
        sale_price: 950000,
      }),
      expect.objectContaining({
        id: 'product-456',
        base_price: 500000,
        sale_price: null,
      }),
    ]);
  });

  it('getCachedProducts leaves untracked products unchanged when serialized summaries are absent', async () => {
    harness.mockListResult.data = [
      {
        id: 'product-untracked',
        inventory_tracking_policy: 'off',
        manage_stock: false,
        quantity: 12,
        slug: 'untracked-product',
        stock: 12,
        stock_quantity: 12,
        track_quantity: false,
      },
    ];
    harness.mockListResult.error = null;
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });
    vi.mocked(
      getPublicSerializedVariantSummariesByProductId
    ).mockResolvedValueOnce([]);

    await expect(getCachedProducts('merchant-123')).resolves.toEqual([
      {
        base_price: 0,
        id: 'product-untracked',
        inventory_tracking_policy: 'off',
        manage_stock: false,
        product_variants: [],
        quantity: 12,
        sale_price: null,
        slug: 'untracked-product',
        stock: 12,
        stock_quantity: 12,
        track_quantity: false,
      },
    ]);
  });

  it('getCachedProducts applies serialized-then-unlimited fallback to simple products', async () => {
    harness.mockListResult.data = [
      {
        id: 'product-123',
        manage_stock: true,
        quantity: 0,
        slug: 'iphone-16',
        stock_quantity: 0,
      },
    ];
    harness.mockListResult.error = null;
    harness.mockRpc.mockResolvedValueOnce({
      data: [],
      error: null,
    });
    vi.mocked(
      getPublicSerializedVariantSummariesByProductId
    ).mockResolvedValueOnce([
      {
        inventoryTrackingPolicy: 'serialized_then_unlimited',
        productId: 'product-123',
        publicAvailableUnits: 0,
        variantId: null,
      },
    ] satisfies PublicSerializedVariantSummary[]);

    await expect(getCachedProducts('merchant-123')).resolves.toEqual([
      expect.objectContaining({
        id: 'product-123',
        inventory_tracking_policy: 'serialized_then_unlimited',
        manage_stock: false,
        quantity: 9999,
        stock: 9999,
        stock_quantity: 9999,
        track_quantity: false,
      }),
    ]);
    expect(getPublicSerializedVariantSummariesByProductId).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(Function) }),
      'merchant-123',
      ['product-123']
    );
  });

  it('getCachedProducts throws when serialized summary fetch fails so the cache cannot persist stale stock', async () => {
    const fetchError = new Error('RPC failed');
    harness.mockListResult.data = [{ id: 'product-123', slug: 'iphone-16' }];
    harness.mockListResult.error = null;
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });
    vi.mocked(
      getPublicSerializedVariantSummariesByProductId
    ).mockRejectedValueOnce(fetchError);

    await expect(getCachedProducts('merchant-123')).rejects.toBe(fetchError);
  });

  it('getCachedProducts throws when the public variant RPC fails to avoid caching empty variants', async () => {
    harness.mockListResult.data = productList;
    harness.mockListResult.error = null;
    harness.mockRpc.mockResolvedValueOnce(rpcFailure);

    await expect(getCachedProducts('merchant-123')).rejects.toEqual(
      rpcFailure.error
    );
    expect(harness.mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_variants',
      {
        p_product_ids: ['product-123', 'product-456'],
      }
    );
  });

  it('getCachedProductWithDetails returns null only for an explicit not-found snapshot', async () => {
    harness.mockRpc.mockResolvedValueOnce(missingPdpSnapshot);

    await expect(
      getCachedProductWithDetails('merchant-123', 'missing-product')
    ).resolves.toBeNull();
  });

  it('getCachedLegacyProductRedirectTarget throws on snapshot error to avoid caching false misses', async () => {
    harness.mockRpc.mockResolvedValueOnce({
      ...productQueryError,
      status: 500,
    });

    await expect(
      getCachedLegacyProductRedirectTarget('merchant-123', 'missing-product')
    ).rejects.toMatchObject({
      failure: {
        code: '42P01',
        operation: 'pdp_core_snapshot',
      },
    });
  });

  it('getCachedLegacyProductRedirectTarget returns the canonical parent from the snapshot', async () => {
    harness.mockRpc.mockResolvedValueOnce({
      data: [
        {
          resolution_status: 'redirect',
          product_data: {
            categories: { id: 'category-123', name: 'Phones', slug: 'phones' },
            id: 'parent-product',
            name: 'Canonical Phone',
            slug: 'canonical-phone',
            status: 'active',
          },
        },
      ],
      error: null,
      status: 200,
    });

    await expect(
      getCachedLegacyProductRedirectTarget('merchant-123', 'legacy-phone')
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'parent-product',
        slug: 'canonical-phone',
      })
    );
  });

  it('getCachedProductWithDetails includes variants from the same snapshot', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedPdpSnapshot({
        ...singleProduct,
        product_variants: [
          {
            id: 'variant-2',
            product_id: 'product-123',
            attributes: { storage: '256GB' },
            stock_quantity: 1,
          },
        ],
      })
    );

    const result = await getCachedProductWithDetails(
      'merchant-123',
      'iphone-16'
    );

    expect(result?.product_variants).toEqual([
      expect.objectContaining({
        id: 'variant-2',
        attributes: { storage: '256GB' },
      }),
    ]);
    expect(harness.mockRpc).toHaveBeenCalledWith(
      'get_storefront_pdp_core_v2',
      {
        // p_branch_id omitted: null would GET-serialize to the literal
        // string 'null' and 22P02 the RPC (see storefront-pdp-core-snapshot).
        p_merchant_id: 'merchant-123',
        p_product_slug: 'iphone-16',
      },
      { get: true }
    );
  });

  it('getCachedProductWithDetails throws when the snapshot RPC fails to avoid caching partial products', async () => {
    harness.mockRpc.mockResolvedValueOnce(rpcFailure);

    await expect(
      getCachedProductWithDetails('merchant-123', 'iphone-16')
    ).rejects.toMatchObject({
      failure: {
        code: 'P0001',
        operation: 'pdp_core_snapshot',
      },
    });
    expect(harness.mockRpc).toHaveBeenCalledWith(
      'get_storefront_pdp_core_v2',
      {
        // p_branch_id omitted: null would GET-serialize to the literal
        // string 'null' and 22P02 the RPC (see storefront-pdp-core-snapshot).
        p_merchant_id: 'merchant-123',
        p_product_slug: 'iphone-16',
      },
      { get: true }
    );
  });

  it('getCachedCategoryPageData includes products from child categories', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-smartphones',
        name: 'Smartphones',
        slug: 'smartphones',
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

    harness.mockListResult.data = [
      { id: 'cat-smartphones' },
      { id: 'cat-iphone' },
    ];
    const productIdsResult = {
      data: [{ id: 'product-1' }, { id: 'product-2' }],
      error: null,
    };
    const productQueryResult = {
      data: [
        { id: 'product-1', name: 'iPhone 15', brand: 'Apple' },
        { id: 'product-2', name: 'Galaxy S24', brand: 'Samsung' },
      ],
      error: null,
    };
    harness.mockQueryExecution
      .mockImplementationOnce(() => Promise.resolve(harness.mockListResult))
      .mockImplementationOnce(() => Promise.resolve(productIdsResult))
      // Exact head-count query (PR4b pagination truth) — matches the ID list,
      // so the catalogue is provably complete and no tail assembly runs.
      .mockImplementationOnce(() =>
        Promise.resolve({ data: null, error: null, count: 2 })
      )
      .mockImplementationOnce(() => Promise.resolve(productQueryResult));

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'smartphones',
      'test-store'
    );

    expect(harness.mockIn).toHaveBeenCalledWith(
      'product_categories.category_id',
      ['cat-smartphones', 'cat-iphone']
    );
    expect(harness.mockEq).toHaveBeenCalledWith('is_active', true);
    // The ordered ID list is capped (CATEGORY_PAGE_PRODUCT_ID_CAP) so the cache
    // item stays bounded; each scope branch orders by `id` last, so the limit is
    // deterministic. This assertion previously pinned the UNCAPPED read.
    expect(harness.mockLimit).toHaveBeenCalledWith(2000);
    const selectArg = String(harness.mockSelect.mock.calls.at(-1)?.[0]);
    expect(selectArg).toContain('product_key_specs (');
    expect(selectArg).not.toMatch(/,\s*product_key_specs\s*,/);
    expect(result.products).toEqual(productQueryResult.data);
    expect(harness.mockOrder).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
    expect(harness.mockOrder).toHaveBeenCalledWith('id', {
      ascending: true,
    });
    expect(harness.mockRange).not.toHaveBeenCalled();
  });

  it('filters server-paginated category IDs and counts through the key-spec relation', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-laptops',
        name: 'Gaming Laptops',
        slug: 'gaming-laptops',
        description: 'Gaming laptops',
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
    harness.mockListResult.data = [{ id: 'cat-laptops' }];
    harness.mockQueryExecution
      .mockResolvedValueOnce(harness.mockListResult)
      .mockResolvedValueOnce({ data: [{ id: 'product-rtx' }], error: null })
      .mockResolvedValueOnce({ data: null, error: null, count: 1 })
      .mockResolvedValueOnce({
        data: [{ id: 'product-rtx', name: 'RTX Laptop' }],
        error: null,
      });

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'gaming-laptops',
      'test-store',
      0,
      20,
      { graphics: ['NVIDIA RTX 4070'] }
    );

    expect(harness.mockIn).toHaveBeenCalledWith('product_key_specs.gpu', [
      'NVIDIA RTX 4070',
    ]);
    const idSelects = harness.mockSelect.mock.calls
      .map(([selection]) => String(selection))
      .filter((selection) =>
        selection.includes('product_key_specs!inner(gpu)')
      );
    expect(idSelects).toHaveLength(2);
    expect(result.productCount).toBe(1);
    expect(result.products).toEqual([
      { id: 'product-rtx', name: 'RTX Laptop' },
    ]);
  });

  it('builds distinct graphics facets from the complete category ID scope', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-laptops',
        name: 'Gaming Laptops',
        slug: 'gaming-laptops',
        description: 'Gaming laptops',
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
    harness.mockListResult.data = [{ id: 'cat-laptops' }];
    harness.mockQueryExecution
      .mockResolvedValueOnce(harness.mockListResult)
      .mockResolvedValueOnce({
        data: [{ id: 'product-1' }, { id: 'product-2' }],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null, count: 2 })
      .mockResolvedValueOnce({
        data: [
          { gpu: ' NVIDIA RTX 4070 ' },
          { gpu: 'Integrated Graphics' },
          { gpu: 'NVIDIA RTX 4070' },
        ],
        error: null,
      });

    const result = await getCachedCategoryPageGraphicsOptions(
      'merchant-123',
      'gaming-laptops',
      'test-store'
    );

    expect(harness.mockFrom).toHaveBeenCalledWith('product_key_specs');
    expect(harness.mockSelect).toHaveBeenCalledWith('gpu');
    expect(result).toEqual(['Integrated Graphics', 'NVIDIA RTX 4070']);
  });

  it('getCachedCategoryPageData applies deterministic ordering to collection ID lists', async () => {
    const collectionCases = [
      {
        slug: 'new-arrivals',
        primaryOrder: ['created_at', { ascending: false }],
      },
      {
        slug: 'best-sellers',
        primaryOrder: ['rating', { ascending: false }],
      },
      {
        slug: 'featured',
        primaryOrder: ['price', { ascending: false }],
      },
      {
        slug: 'on-sale',
        primaryOrder: ['updated_at', { ascending: false }],
      },
    ] as const;

    for (const { slug, primaryOrder } of collectionCases) {
      harness = buildCachedDataTestHarness();

      await getCachedCategoryPageData('merchant-123', slug, 'test-store');

      expect(harness.mockOrder).toHaveBeenCalledWith(...primaryOrder);
      expect(harness.mockOrder).toHaveBeenCalledWith('id', {
        ascending: true,
      });
      expect(harness.mockRange).not.toHaveBeenCalled();

      if (slug === 'on-sale') {
        expect(harness.mockNot).toHaveBeenCalledWith(
          'compare_at_price',
          'is',
          null
        );
      }
    }
  });

  it('getCachedCategoryPageData keeps legacy category fallback products and stable ranged ordering', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });
    harness.mockRpc.mockResolvedValueOnce({ data: [], error: null });
    const legacyProductIds = [{ id: 'legacy-product-1' }];
    const legacyProducts = [{ id: 'legacy-product-1', name: 'Laptop Pro' }];
    harness.mockQueryExecution
      .mockResolvedValueOnce({
        data: legacyProductIds,
        error: null,
      })
      // Exact head-count query (PR4b pagination truth) — matches the ID list,
      // so the catalogue is provably complete and no tail assembly runs.
      .mockResolvedValueOnce({ data: null, error: null, count: 1 })
      .mockResolvedValueOnce({
        data: legacyProducts,
        error: null,
      });

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'gaming-laptops',
      'test-store'
    );

    expect(harness.mockFrom).toHaveBeenCalledWith('products');
    expect(harness.mockOr).toHaveBeenCalledWith(
      'category.ilike.%Gaming Laptops%,brand.ilike.%Gaming Laptops%,name.ilike.%Gaming Laptops%'
    );
    expect(harness.mockOrder).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
    expect(harness.mockOrder).toHaveBeenCalledWith('id', {
      ascending: true,
    });
    expect(harness.mockRange).not.toHaveBeenCalled();
    expect(result.isCollection).toBe(false);
    expect(result.products).toEqual(legacyProducts);
    if (!result.isCollection) {
      expect(result.productsQueryFailed).toBe(false);
    }
  });

  it('getCachedCategoryPageData does not use loose fallback for active canonical categories with no products', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-empty',
        name: 'Empty Category',
        slug: 'empty-category',
        description: 'No products yet',
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

    harness.mockListResult.data = [{ id: 'cat-empty' }];
    harness.mockQueryExecution
      .mockImplementationOnce(() => Promise.resolve(harness.mockListResult))
      .mockImplementationOnce(() =>
        Promise.resolve({
          data: [],
          error: null,
        })
      )
      // Exact head-count query (PR4b pagination truth) — runs unconditionally,
      // even for an empty scope.
      .mockImplementationOnce(() =>
        Promise.resolve({ data: null, error: null, count: 0 })
      );

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'empty-category',
      'test-store'
    );

    expect(harness.mockOr).toHaveBeenCalledTimes(1);
    expect(harness.mockOr).toHaveBeenCalledWith(
      'id.eq.cat-empty,parent_id.eq.cat-empty'
    );
    // Scope resolution + ID query + exact head-count. No detail query: the ID
    // list is empty, so there is nothing to hydrate — and crucially no loose
    // fallback search runs for an active canonical category.
    expect(harness.mockQueryExecution).toHaveBeenCalledTimes(3);
    expect(result.products).toEqual([]);
  });

  it('getCachedCategoryPageData marks inactive categories without loose fallback products', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: {
        id: 'cat-stale',
        name: 'Stale Category',
        slug: 'stale-category',
        description: 'Old category',
        image_url: null,
        is_active: false,
        seo_heading: null,
        seo_description: null,
        seo_features: null,
        seo_faq: null,
        parent: null,
      },
      error: null,
    });

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'stale-category',
      'test-store'
    );

    expect(result).toMatchObject({
      isCollection: false,
      category: null,
      fallbackName: 'Stale Category',
      fallbackDescription: 'Old category',
      isInactiveCategory: true,
      products: [],
    });
    expect(harness.mockQueryExecution).not.toHaveBeenCalled();
    expect(harness.mockOr).not.toHaveBeenCalled();
  });

  it('getCachedCategoryPageData detects inactive categories hidden by public RLS', async () => {
    harness.mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });
    harness.mockRpc.mockResolvedValueOnce({
      data: [{ is_active: false }],
      error: null,
    });

    const result = await getCachedCategoryPageData(
      'merchant-123',
      'hidden-category',
      'test-store'
    );

    expect(harness.mockRpc).toHaveBeenCalledWith(
      'get_storefront_category_slug_state',
      {
        p_merchant_id: 'merchant-123',
        p_slug: 'hidden-category',
      }
    );
    expect(result).toMatchObject({
      isCollection: false,
      category: null,
      fallbackName: 'Hidden Category',
      isInactiveCategory: true,
      products: [],
    });
    expect(harness.mockQueryExecution).not.toHaveBeenCalled();
    expect(harness.mockOr).not.toHaveBeenCalled();
  });
});
