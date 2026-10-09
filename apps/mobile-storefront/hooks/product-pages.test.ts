import { beforeEach, describe, expect, it, jest } from '@jest/globals';

interface QueryResult {
  count: number | null;
  data: Record<string, unknown>[] | null;
  error: Error | null;
}

interface RpcResult {
  data: unknown;
  error: unknown;
}

function mockVariantRpcQuery(result: Promise<RpcResult>) {
  const rpcQuery = {
    order: jest.fn(),
    range: jest.fn(async () => {
      const resolved = await result;
      return {
        ...resolved,
        count: resolved.error
          ? null
          : Array.isArray(resolved.data)
            ? resolved.data.length
            : 0,
      };
    }),
  };
  rpcQuery.order.mockReturnValue(rpcQuery);
  return rpcQuery;
}

const queryResult: QueryResult = {
  count: 0,
  data: [],
  error: null,
};
const mockRpc = jest.fn<(...args: unknown[]) => Promise<RpcResult>>();

const query = {
  eq: jest.fn(),
  gte: jest.fn(),
  lte: jest.fn(),
  or: jest.fn(),
  order: jest.fn(),
  range: jest.fn(),
  select: jest.fn(),
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are intentionally awaitable.
  then: (
    resolve: (result: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(queryResult).then(resolve, reject),
};

for (const method of [
  query.eq,
  query.gte,
  query.lte,
  query.or,
  query.order,
  query.range,
  query.select,
]) {
  method.mockReturnValue(query);
}

const mockFrom: jest.Mock = jest.fn(() => query);

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => {
      const result = mockRpc(...args);
      return args[0] === 'get_storefront_product_variants'
        ? mockVariantRpcQuery(result)
        : result;
    },
  },
}));
jest.mock('./product-transform', () => ({
  transformProduct: (row: unknown) => row,
}));

import { fetchProductsPage } from './product-pages';
import { PRODUCT_SELECT } from './product-select';

describe('fetchProductsPage catalog variant hydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryResult.count = 0;
    queryResult.data = [];
    queryResult.error = null;
    mockRpc.mockResolvedValue({ data: [], error: null });
  });

  it('hydrates every variant product with one rpc and preserves page order', async () => {
    queryResult.count = 3;
    queryResult.data = [
      { has_variants: true, id: 'product-1', name: 'One' },
      { has_variants: false, id: 'simple-product', name: 'Simple' },
      { has_variants: true, id: 'product-2', name: 'Two' },
    ];
    mockRpc.mockResolvedValueOnce({
      data: [
        { id: 'variant-2', product_id: 'product-2' },
        { id: 'variant-1', product_id: 'product-1' },
      ],
      error: null,
    });

    const result = await fetchProductsPage('merchant-1', { limit: 3 }, 0);

    expect(mockFrom).toHaveBeenCalledWith('products');
    expect(query.select).toHaveBeenCalledWith(PRODUCT_SELECT, {
      count: 'exact',
    });
    expect(query.range).toHaveBeenCalledWith(0, 2);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      'get_storefront_product_variants',
      { p_product_ids: ['product-1', 'product-2'] },
      { count: 'exact' }
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'get_storefront_product_base_inventory',
      { p_product_ids: ['simple-product'] }
    );
    expect(result).toEqual({
      nextOffset: null,
      products: [
        expect.objectContaining({
          id: 'product-1',
          variants: [expect.objectContaining({ id: 'variant-1' })],
        }),
        expect.objectContaining({ id: 'simple-product' }),
        expect.objectContaining({
          id: 'product-2',
          variants: [expect.objectContaining({ id: 'variant-2' })],
        }),
      ],
      total: 3,
    });
  });

  it('does not hydrate variants when the product query fails', async () => {
    queryResult.data = null;
    queryResult.error = new Error('catalog query failed');

    await expect(
      fetchProductsPage('merchant-1', { limit: 20 }, 0)
    ).rejects.toThrow('catalog query failed');

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('keeps the catalog page available when the variant rpc fails', async () => {
    const productRow = {
      has_variants: true,
      id: 'product-1',
      name: 'Variant product',
    };
    queryResult.count = 1;
    queryResult.data = [productRow];
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'variant rpc unavailable' },
    });

    const result = await fetchProductsPage('merchant-1', { limit: 20 }, 0);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(result.products).toEqual([productRow]);
  });
});

describe('fetchProductsPage normalized-empty search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryResult.count = 0;
    queryResult.data = [];
    queryResult.error = null;
    mockRpc.mockResolvedValue({ data: [], error: null });
  });

  it('returns an empty page instead of the catalog for punctuation-only queries', async () => {
    const result = await fetchProductsPage(
      'merchant-1',
      { limit: 20, search: '!!' },
      0
    );

    expect(result).toEqual({ nextOffset: null, products: [], total: 0 });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
