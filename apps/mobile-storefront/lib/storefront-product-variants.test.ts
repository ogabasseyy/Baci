import { jest } from '@jest/globals';
import {
  getStorefrontProductBaseInventoryByProductIds,
  getStorefrontProductVariantsByProductIds,
  hydrateProductRowsWithBaseInventory,
  hydrateProductRowsWithStorefrontVariants,
} from '@/lib/storefront-product-variants';

const mockWithSupabaseRetry = jest.fn();
const mockRange =
  jest.fn<
    (
      from: number,
      to: number
    ) => Promise<{
      count: number | null;
      data: unknown;
      error: unknown;
    }>
  >();
const mockRpcQuery = {
  order: jest.fn(),
  range: (...args: [number, number]) => mockRange(...args),
};
mockRpcQuery.order.mockReturnValue(mockRpcQuery);
const mockRpc = jest.fn<
  (
    ...args: unknown[]
  ) => typeof mockRpcQuery | Promise<{ data: unknown; error: unknown }>
>(() => mockRpcQuery);

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>, options?: unknown) =>
    mockWithSupabaseRetry(operation, options),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

describe('storefront-product-variants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRange.mockResolvedValue({ count: 0, data: [], error: null });
    mockWithSupabaseRetry.mockImplementation((...args: unknown[]) => {
      const operation = args[0] as () => Promise<unknown>;
      return operation();
    });
  });

  it('returns an empty object without calling the rpc when no product ids are provided', async () => {
    await expect(getStorefrontProductVariantsByProductIds([])).resolves.toEqual(
      {}
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('deduplicates product ids into one bounded rpc page', async () => {
    await getStorefrontProductVariantsByProductIds([
      'product-1',
      'product-2',
      'product-1',
    ]);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_variants',
      { p_product_ids: ['product-1', 'product-2'] },
      { count: 'exact' }
    );
    expect(mockRpcQuery.order).toHaveBeenNthCalledWith(1, 'product_id', {
      ascending: true,
    });
    expect(mockRpcQuery.order).toHaveBeenNthCalledWith(2, 'created_at', {
      ascending: true,
      nullsFirst: false,
    });
    expect(mockRpcQuery.order).toHaveBeenNthCalledWith(3, 'id', {
      ascending: true,
    });
    expect(mockRange).toHaveBeenCalledWith(0, 999);
  });

  it('hydrates rows with storefront-safe variants from the rpc', async () => {
    mockRange.mockResolvedValue({
      count: 1,
      data: [
        {
          id: 'variant-1',
          product_id: 'product-1',
          condition: 'used',
          price_override: '470000.00',
          stock_quantity: 0,
          attributes: {
            storage: '64GB',
          },
        },
      ],
      error: null,
    });

    const rows = await hydrateProductRowsWithStorefrontVariants([
      { id: 'product-1', variants: [] },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'product-1',
        variants: [
          expect.objectContaining({
            condition: 'used',
            price_override: '470000.00',
          }),
        ],
      }),
    ]);
  });

  it('returns rows unchanged when there are no row ids to hydrate', async () => {
    const rows = [{ slug: 'no-id' }, { id: null, variants: [] }];

    await expect(
      hydrateProductRowsWithStorefrontVariants(rows)
    ).resolves.toEqual(rows);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns rows unchanged when the rpc errors', async () => {
    mockRange.mockResolvedValue({
      count: null,
      data: null,
      error: { message: 'boom' },
    });

    const rows = [{ id: 'product-1', variants: [{ id: 'embedded-variant' }] }];

    await expect(
      hydrateProductRowsWithStorefrontVariants(rows)
    ).resolves.toEqual(rows);
  });

  it('clears stale embedded variants when a successful rpc returns no visible variants', async () => {
    mockRange.mockResolvedValue({
      count: 0,
      data: [],
      error: null,
    });

    const rows = [
      { id: 'product-1', variants: [{ id: 'hidden-inventory-anchor' }] },
    ];

    await expect(
      hydrateProductRowsWithStorefrontVariants(rows)
    ).resolves.toEqual([{ id: 'product-1', variants: [] }]);
  });

  it('groups rpc variants by product id', async () => {
    mockRange.mockResolvedValue({
      count: 2,
      data: [
        {
          id: 'variant-1',
          product_id: 'product-1',
          attributes: { storage: '64GB' },
        },
        {
          id: 'variant-2',
          product_id: 'product-2',
          attributes: { storage: '256GB' },
        },
      ],
      error: null,
    });

    const variantsByProductId = await getStorefrontProductVariantsByProductIds([
      'product-1',
      'product-2',
    ]);

    expect(variantsByProductId).toEqual({
      'product-1': [expect.objectContaining({ id: 'variant-1' })],
      'product-2': [expect.objectContaining({ id: 'variant-2' })],
    });
  });

  it('groups multiple variants for the same product id', async () => {
    mockRange.mockResolvedValue({
      count: 2,
      data: [
        {
          id: 'variant-1',
          product_id: 'product-1',
          attributes: { storage: '64GB' },
        },
        {
          id: 'variant-2',
          product_id: 'product-1',
          attributes: { storage: '256GB' },
        },
      ],
      error: null,
    });

    await expect(
      getStorefrontProductVariantsByProductIds(['product-1'])
    ).resolves.toEqual({
      'product-1': [
        expect.objectContaining({ id: 'variant-1' }),
        expect.objectContaining({ id: 'variant-2' }),
      ],
    });
  });

  it('returns null when the rpc errors', async () => {
    mockRange.mockResolvedValue({
      count: null,
      data: null,
      error: { message: 'boom' },
    });

    await expect(
      getStorefrontProductVariantsByProductIds(['product-1'])
    ).resolves.toBeNull();
  });

  it('loads every variant when the rpc result exceeds the PostgREST row cap', async () => {
    const firstPage = Array.from({ length: 600 }, (_, index) => ({
      id: `variant-${index}`,
      product_id: 'product-1',
    }));
    const secondPage = Array.from({ length: 401 }, (_, index) => ({
      id: `variant-${index + 600}`,
      product_id: 'product-2',
    }));
    mockRange
      .mockResolvedValueOnce({
        count: 1001,
        data: firstPage,
        error: null,
      })
      .mockResolvedValueOnce({
        count: 1001,
        data: secondPage,
        error: null,
      });

    const variants = await getStorefrontProductVariantsByProductIds([
      'product-1',
      'product-2',
    ]);

    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRange).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mockRange).toHaveBeenNthCalledWith(2, 600, 1599);
    expect(variants?.['product-1']).toHaveLength(600);
    expect(variants?.['product-2']).toHaveLength(401);
    expect(variants?.['product-2']?.at(-1)).toEqual(
      expect.objectContaining({ id: 'variant-1000' })
    );
  });

  it('returns null instead of exposing a partial multi-page response', async () => {
    mockRange
      .mockResolvedValueOnce({
        count: 1001,
        data: Array.from({ length: 1000 }, (_, index) => ({
          id: `variant-${index}`,
          product_id: 'product-1',
        })),
        error: null,
      })
      .mockResolvedValueOnce({
        count: null,
        data: null,
        error: { message: 'page failed' },
      });

    await expect(
      getStorefrontProductVariantsByProductIds(['product-1'])
    ).resolves.toBeNull();
  });

  it('returns an empty object without calling the rpc when no base ids are provided', async () => {
    await expect(
      getStorefrontProductBaseInventoryByProductIds([])
    ).resolves.toEqual({});
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps base inventory rows by product id in one rpc call', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({
        data: [
          {
            product_id: 'product-1',
            effective_policy: 'serialized_strict',
            available_units: 4,
          },
        ],
        error: null,
      })
    );

    await expect(
      getStorefrontProductBaseInventoryByProductIds(['product-1', 'product-1'])
    ).resolves.toEqual({
      'product-1': {
        product_id: 'product-1',
        effective_policy: 'serialized_strict',
        available_units: 4,
      },
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_base_inventory',
      { p_product_ids: ['product-1'] }
    );
  });

  it('returns null when the base inventory lookup fails', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({ data: null, error: { message: 'boom' } })
    );

    await expect(
      getStorefrontProductBaseInventoryByProductIds(['product-1'])
    ).resolves.toBeNull();
  });

  it('attaches base inventory to matching rows and leaves the rest untouched', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({
        data: [
          {
            product_id: 'product-1',
            effective_policy: 'serialized_strict',
            available_units: 4,
          },
        ],
        error: null,
      })
    );

    const rows = [{ id: 'product-1' }, { id: 'product-2' }];
    await expect(hydrateProductRowsWithBaseInventory(rows)).resolves.toEqual([
      {
        id: 'product-1',
        base_effective_policy: 'serialized_strict',
        base_available_units: 4,
      },
      { id: 'product-2' },
    ]);
  });
});
