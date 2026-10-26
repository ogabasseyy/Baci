import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedProductSemanticInventory } from './get-cached-product-semantic-inventory';

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
      },
    ]);
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
});
