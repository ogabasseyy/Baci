import { expect, it, jest } from '@jest/globals';

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
  ilike: jest.fn(),
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
  query.ilike,
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

it('keeps ranked provider search for production instead of using sandbox name filtering', async () => {
  const previous = { ...process.env };
  try {
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    process.env.EXPO_PUBLIC_API_URL = 'https://ogabassey.com';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ data: [], error: null });
    await fetchProductsPage(
      '10000000-0000-4000-8000-000000000001',
      { search: 'synthetic' },
      0
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ search_query: 'synthetic' })
    );
    expect(query.ilike).not.toHaveBeenCalled();
  } finally {
    for (const name of [
      'EXPO_PUBLIC_HOSTED_STOREFRONT',
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_SUPABASE_URL',
    ]) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

it('preserves production browse filters, projection, and sort when refinements are present', async () => {
  const previous = { ...process.env };
  try {
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    process.env.EXPO_PUBLIC_API_URL = 'https://ogabassey.com';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
    jest.clearAllMocks();
    queryResult.data = [];
    queryResult.count = 0;
    queryResult.error = null;

    await fetchProductsPage(
      '10000000-0000-4000-8000-000000000001',
      {
        category: 'production-category',
        condition: 'used',
        brand: 'Legacy brand',
        minPrice: 100,
        maxPrice: 500,
        minRating: 4,
        sortBy: 'popular',
        refinements: {
          brands: ['Sandbox brand'],
          categoryId: 'sandbox-category',
          processor: 'Intel Core i7',
          sort: 'price_asc',
        },
      },
      0
    );

    expect(mockFrom).toHaveBeenCalledWith('products');
    expect(query.select).toHaveBeenCalledWith(PRODUCT_SELECT, {
      count: 'exact',
    });
    expect(query.eq).toHaveBeenCalledWith('category_id', 'production-category');
    expect(query.or).toHaveBeenCalledWith(
      'condition.eq.used,available_conditions.cs.{used}'
    );
    expect(query.eq).toHaveBeenCalledWith('brand', 'Legacy brand');
    expect(query.gte).toHaveBeenCalledWith('price', 100);
    expect(query.lte).toHaveBeenCalledWith('price', 500);
    expect(query.gte).toHaveBeenCalledWith('average_rating', 4);
    expect(query.order).toHaveBeenCalledWith('view_count', {
      ascending: false,
    });
    expect(query.range).toHaveBeenCalledWith(0, 19);
    expect(mockRpc).not.toHaveBeenCalled();
  } finally {
    for (const name of [
      'EXPO_PUBLIC_HOSTED_STOREFRONT',
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_SUPABASE_URL',
    ]) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

it('searches the pinned sandbox catalog without calling its unavailable search RPC', async () => {
  const previous = { ...process.env };
  try {
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    process.env.EXPO_PUBLIC_API_URL = 'https://staging.ogabassey.com';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
    jest.clearAllMocks();
    queryResult.data = [
      { id: 'test-phone', name: 'Synthetic phone', has_variants: false },
    ];
    queryResult.count = 1;
    queryResult.error = null;
    const result = await fetchProductsPage(
      '10000000-0000-4000-8000-000000000001',
      { search: 'synthetic', limit: 8 },
      0
    );
    expect(mockRpc).not.toHaveBeenCalledWith(
      'search_products_v2',
      expect.anything()
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_base_inventory',
      { p_product_ids: ['test-phone'] }
    );
    expect(query.ilike).toHaveBeenCalledWith('name', '%synthetic%');
    expect(query.eq).toHaveBeenCalledWith(
      'merchant_id',
      '10000000-0000-4000-8000-000000000001'
    );
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(result.products).toEqual([
      expect.objectContaining({ name: 'Synthetic phone' }),
    ]);
  } finally {
    for (const name of [
      'EXPO_PUBLIC_HOSTED_STOREFRONT',
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_SUPABASE_URL',
    ]) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
