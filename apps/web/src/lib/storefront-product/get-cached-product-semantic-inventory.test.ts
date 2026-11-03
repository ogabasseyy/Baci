import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedProductSemanticInventory,
  PRODUCT_SEMANTIC_INVENTORY_BASE_SELECT,
} from './get-cached-product-semantic-inventory';

const mockGetPublicSupabaseClient = vi.fn();

vi.mock('@/lib/cached-data', () => ({
  getPublicSupabaseClient: () => mockGetPublicSupabaseClient(),
}));

function createProductsQuery(result: {
  data?: unknown[] | null;
  error?: unknown;
}) {
  const query = {
    eq: vi.fn(() => query),
    limit: vi.fn(() => query),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
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

describe('getCachedProductSemanticInventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches a narrow category-scoped semantic candidate list', async () => {
    const productsQuery = createProductsQuery({
      data: [
        {
          slug: 'macbook-pro',
          name: 'MacBook Pro',
          price: '4,500,000',
          brand: 'Apple',
          condition: 'new',
          stock_quantity: 7,
          product_categories: [{ categories: { slug: 'laptops' } }],
          product_key_specs: [{ ram_gb: 16, storage_gb: 512 }],
        },
        {
          slug: 'blank-price',
          name: 'Invalid row',
          price: '   ',
          product_categories: [{ categories: { slug: 'laptops' } }],
        },
      ],
      error: null,
    });
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });

    const result = await getCachedProductSemanticInventory(
      'merchant-1',
      'laptops'
    );

    expect(productsQuery.select).toHaveBeenCalledWith(
      expect.stringContaining(
        'product_categories!inner(categories!inner(slug))'
      )
    );
    expect(productsQuery.select).toHaveBeenCalledWith(
      expect.stringContaining('manage_stock')
    );
    expect(productsQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(productsQuery.eq).toHaveBeenCalledWith('status', 'active');
    expect(productsQuery.eq).toHaveBeenCalledWith(
      'product_categories.categories.slug',
      'laptops'
    );
    expect(productsQuery.limit).toHaveBeenCalledWith(300);
    // The fix for the ~34s compare stall: bound this optional read and disable
    // PostgREST auto-retry so an AbortSignal.timeout TimeoutError cannot fan out
    // into 4 attempts. Removing either re-introduces the stall.
    expect(productsQuery.abortSignal).toHaveBeenCalledWith(
      expect.any(AbortSignal)
    );
    expect(productsQuery.retry).toHaveBeenCalledWith(false);
    expect(result).toEqual([
      {
        slug: 'macbook-pro',
        name: 'MacBook Pro',
        price: 4_500_000,
        brand: 'Apple',
        condition: 'new',
        stock: 7,
        category_slug: 'laptops',
        product_key_specs: { ram_gb: 16, storage_gb: 512 },
        is_parent: null,
        parent_product_id: null,
        manage_stock: null,
      },
    ]);
  });

  it('keeps legacy stock when stock_quantity is zero (effective stock)', async () => {
    const productsQuery = createProductsQuery({
      data: [
        {
          slug: 'legacy-stock-phone',
          name: 'Legacy Stock Phone',
          price: 100000,
          brand: 'Apple',
          stock: 9,
          stock_quantity: 0,
          product_categories: [{ categories: { slug: 'smartphones' } }],
        },
      ],
      error: null,
    });
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });
    const result = await getCachedProductSemanticInventory(
      'merchant-1',
      'smartphones'
    );
    expect(result[0]?.stock).toBe(9);
  });

  it('reaches the database again after a transient query failure', async () => {
    const failedQuery = createProductsQuery({
      data: null,
      error: { message: 'timeout' },
    });
    const recoveredQuery = createProductsQuery({
      data: [
        {
          slug: 'recovered-product',
          name: 'Recovered Product',
          price: 100,
          product_categories: [{ categories: { slug: 'laptops' } }],
        },
      ],
      error: null,
    });
    const from = vi
      .fn()
      .mockReturnValueOnce(failedQuery)
      .mockReturnValueOnce(recoveredQuery);
    mockGetPublicSupabaseClient.mockReturnValue({
      from,
    });

    await expect(
      getCachedProductSemanticInventory('merchant-1', 'laptops')
    ).rejects.toMatchObject({ message: 'timeout' });
    await expect(
      getCachedProductSemanticInventory('merchant-1', 'laptops')
    ).resolves.toEqual([
      expect.objectContaining({ slug: 'recovered-product' }),
    ]);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['empty result set', []],
    ['null result set', null],
  ])('returns an empty list for a cacheable %s', async (_label, data) => {
    const productsQuery = createProductsQuery({
      data,
      error: null,
    });
    mockGetPublicSupabaseClient.mockReturnValue({
      from: vi.fn(() => productsQuery),
    });

    await expect(
      getCachedProductSemanticInventory('merchant-1', 'laptops')
    ).resolves.toEqual([]);
  });

  it('includes manage_stock in PRODUCT_SEMANTIC_INVENTORY_BASE_SELECT', () => {
    expect(PRODUCT_SEMANTIC_INVENTORY_BASE_SELECT).toContain('manage_stock');
  });

  describe('manage_stock candidate stock resolution', () => {
    it.each([
      {
        label: 'unmanaged with false',
        row: {
          slug: 'unmanaged-false',
          name: 'Unmanaged False',
          price: 100,
          manage_stock: false,
          stock: 0,
          stock_quantity: 0,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: null,
        expectedManageStock: false,
      },
      {
        label: 'unmanaged with null',
        row: {
          slug: 'unmanaged-null',
          name: 'Unmanaged Null',
          price: 100,
          manage_stock: null,
          stock: 0,
          stock_quantity: 0,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: null,
        expectedManageStock: null,
      },
      {
        label: 'tracked zero stock with true',
        row: {
          slug: 'tracked-zero',
          name: 'Tracked Zero',
          price: 100,
          manage_stock: true,
          stock: 0,
          stock_quantity: 0,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: 0,
        expectedManageStock: true,
      },
      {
        label: 'tracked positive stock with true',
        row: {
          slug: 'tracked-positive',
          name: 'Tracked Positive',
          price: 100,
          manage_stock: true,
          stock: 0,
          stock_quantity: 5,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: 5,
        expectedManageStock: true,
      },
      {
        label:
          'omitted manage_stock with zero stock (strict projection fallback)',
        row: {
          slug: 'omitted-zero',
          name: 'Omitted Zero',
          price: 100,
          stock: 0,
          stock_quantity: 0,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: 0,
        expectedManageStock: null,
      },
      {
        label: 'omitted manage_stock with positive stock',
        row: {
          slug: 'omitted-positive',
          name: 'Omitted Positive',
          price: 100,
          stock: 0,
          stock_quantity: 8,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: 8,
        expectedManageStock: null,
      },
      {
        label:
          'legacy positive stock with zero stock_quantity and manage_stock true',
        row: {
          slug: 'legacy-positive',
          name: 'Legacy Positive',
          price: 100,
          manage_stock: true,
          stock: 9,
          stock_quantity: 0,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: 9,
        expectedManageStock: true,
      },
    ])('resolves candidate stock for $label', async ({
      row,
      expectedStock,
      expectedManageStock,
    }) => {
      const productsQuery = createProductsQuery({
        data: [row],
        error: null,
      });
      mockGetPublicSupabaseClient.mockReturnValue({
        from: vi.fn(() => productsQuery),
      });

      const result = await getCachedProductSemanticInventory(
        'merchant-1',
        'phones'
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.stock).toBe(expectedStock);
      expect(result[0]?.manage_stock).toBe(expectedManageStock);
    });
  });
});
