import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  normalizeProductInventory: vi.fn((product: unknown) => product),
  revalidateStorefrontProducts: vi.fn(),
}));

type ProductsQueryResult = {
  count: number | null;
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

type SingleRowResult = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

type UpdateQuery = {
  update: (payload: Record<string, unknown>) => UpdateQuery;
  eq: (column: string, value: unknown) => UpdateQuery;
  select: (columns: string) => UpdateQuery;
  single: () => Promise<SingleRowResult>;
  maybeSingle: () => Promise<SingleRowResult>;
};

// Mock for the `update().eq().eq().select().single()` chain used by the
// stock/status quick-action writers.
function createUpdateQuery(result: SingleRowResult): UpdateQuery {
  const query = {} as UpdateQuery;
  query.update = vi.fn(() => query) as UpdateQuery['update'];
  query.eq = vi.fn(() => query) as UpdateQuery['eq'];
  query.select = vi.fn(() => query) as UpdateQuery['select'];
  query.single = vi.fn(() => Promise.resolve(result)) as UpdateQuery['single'];
  query.maybeSingle = vi.fn(() =>
    Promise.resolve(result)
  ) as UpdateQuery['maybeSingle'];
  return query;
}

type ProductsQuery = Promise<ProductsQueryResult> & {
  eq: (column: string, value: unknown) => ProductsQuery;
  gt: (column: string, value: unknown) => ProductsQuery;
  is: (column: string, value: unknown) => ProductsQuery;
  lte: (column: string, value: unknown) => ProductsQuery;
  neq: (column: string, value: unknown) => ProductsQuery;
  order: (column: string, options: unknown) => ProductsQuery;
  or: (filters: string) => ProductsQuery;
  range: (from: number, to: number) => ProductsQuery;
  select: (columns: string, options?: unknown) => ProductsQuery;
};

function createProductsQuery(result: ProductsQueryResult): ProductsQuery {
  const query = Promise.resolve(result) as ProductsQuery;
  query.eq = vi.fn(() => query) as ProductsQuery['eq'];
  query.gt = vi.fn(() => query) as ProductsQuery['gt'];
  query.is = vi.fn(() => query) as ProductsQuery['is'];
  query.lte = vi.fn(() => query) as ProductsQuery['lte'];
  query.neq = vi.fn(() => query) as ProductsQuery['neq'];
  query.order = vi.fn(() => query) as ProductsQuery['order'];
  query.or = vi.fn(() => query) as ProductsQuery['or'];
  query.range = vi.fn(() => query) as ProductsQuery['range'];
  query.select = vi.fn(() => query) as ProductsQuery['select'];
  return query;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from },
}));

vi.mock('@/lib/product-inventory', () => ({
  normalizeProductInventory: mocks.normalizeProductInventory,
}));

vi.mock('@/lib/product-search', async () => ({
  ...(await vi.importActual('@/lib/product-search')),
  fetchAdminProductSearchRows: vi.fn(),
}));

vi.mock('@/lib/revalidate-storefront-products', () => ({
  revalidateStorefrontProducts: (...args: unknown[]) =>
    mocks.revalidateStorefrontProducts(...args),
}));

import {
  fetchProducts,
  updateProductStatus,
  updateProductStock,
} from './products-data';

describe('fetchProducts stock filters', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.normalizeProductInventory.mockClear();
  });

  it('excludes archived products from stock results by default', async () => {
    const query = createProductsQuery({ count: 0, data: [], error: null });
    mocks.from.mockReturnValueOnce(query);

    await fetchProducts('merchant-1', 0, { stockFilter: 'in_stock' });

    expect(query.neq).toHaveBeenCalledWith('status', 'archived');
    expect(query.eq).toHaveBeenCalledWith('manage_stock', true);
    expect(query.or).toHaveBeenCalledWith(
      'stock_quantity.gt.0,and(stock_quantity.is.null,stock.gt.0),and(stock_quantity.lte.0,stock.gt.0)'
    );
  });

  it('restricts out-of-stock results to managed inventory', async () => {
    const query = createProductsQuery({ count: 0, data: [], error: null });
    mocks.from.mockReturnValueOnce(query);

    await fetchProducts('merchant-1', 0, { stockFilter: 'out_of_stock' });

    expect(query.eq).toHaveBeenCalledWith('manage_stock', true);
    expect(query.neq).toHaveBeenCalledWith('status', 'archived');
    expect(query.or).toHaveBeenCalledWith(
      'and(stock_quantity.is.null,stock.is.null),and(stock_quantity.is.null,stock.lte.0),and(stock_quantity.lte.0,stock.is.null),and(stock_quantity.lte.0,stock.lte.0)'
    );
  });

  it('keeps archived products when an explicit status filter is selected', async () => {
    const query = createProductsQuery({ count: 0, data: [], error: null });
    mocks.from.mockReturnValueOnce(query);

    await fetchProducts('merchant-1', 0, {
      status: 'archived',
      stockFilter: 'out_of_stock',
    });

    expect(query.eq).toHaveBeenCalledWith('status', 'archived');
    expect(query.neq).not.toHaveBeenCalledWith('status', 'archived');
  });

  it('restricts low-stock results to managed effective stock above zero and at threshold', async () => {
    const query = createProductsQuery({ count: 0, data: [], error: null });
    mocks.from.mockReturnValueOnce(query);

    await fetchProducts('merchant-1', 0, { stockFilter: 'low_stock' });

    expect(query.neq).toHaveBeenCalledWith('status', 'archived');
    expect(query.eq).toHaveBeenCalledWith('manage_stock', true);
    expect(query.or).toHaveBeenCalledWith(
      'and(stock_quantity.gt.0,stock_quantity.lte.5),and(stock_quantity.is.null,stock.gt.0,stock.lte.5),and(stock_quantity.lte.0,stock.gt.0,stock.lte.5)'
    );
  });

  it('excludes untracked inventory from in-stock management results', async () => {
    const row = { id: 'product-1', name: 'Phone', stock_quantity: 3 };
    const normalized = { id: 'product-1', name: 'Phone', stock: 3 };
    mocks.normalizeProductInventory.mockReturnValueOnce(normalized);
    const query = createProductsQuery({ count: 1, data: [row], error: null });
    mocks.from.mockReturnValueOnce(query);

    await expect(
      fetchProducts('merchant-1', 0, { stockFilter: 'in_stock' })
    ).resolves.toEqual({
      nextCursor: null,
      products: [normalized],
      totalCount: 1,
    });

    expect(query.eq).toHaveBeenCalledWith('manage_stock', true);
    expect(query.neq).toHaveBeenCalledWith('status', 'archived');
    expect(query.or).toHaveBeenCalledWith(
      'stock_quantity.gt.0,and(stock_quantity.is.null,stock.gt.0),and(stock_quantity.lte.0,stock.gt.0)'
    );
    expect(mocks.normalizeProductInventory).toHaveBeenCalledWith(row);
  });

  it.each([
    'out_of_stock',
    'low_stock',
    'in_stock',
  ] as const)('throws query errors for %s stock filter', async (stockFilter) => {
    const query = createProductsQuery({
      count: null,
      data: null,
      error: { message: 'products failed' },
    });
    mocks.from.mockReturnValueOnce(query);

    await expect(
      fetchProducts('merchant-1', 0, { stockFilter })
    ).rejects.toThrow('products failed');
  });
});

describe('protected quick-action writes', () => {
  const previous = { id: 'p', slug: 'phone', category: 'Phones' };
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.normalizeProductInventory.mockImplementation(
      (product: unknown) => product
    );
    mocks.revalidateStorefrontProducts.mockReset();
  });
  const run = (action: string) =>
    action === 'stock'
      ? updateProductStock('p', 2, 'm')
      : updateProductStatus('p', 'active', 'm');
  it.each([
    'stock',
    'status',
  ])('preflights, safely writes and hydrates %s', async (action) => {
    const preflight = createUpdateQuery({ data: previous, error: null });
    const write = createUpdateQuery({ data: { id: 'p' }, error: null });
    const read = createUpdateQuery({
      data: { ...previous, cost_price: 12 },
      error: null,
    });
    mocks.from
      .mockReturnValueOnce(preflight)
      .mockReturnValueOnce(write)
      .mockReturnValueOnce(read);
    await run(action);
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
      'merchant_products',
      'products',
      'merchant_products',
    ]);
    expect(preflight.maybeSingle).toHaveBeenCalledOnce();
    expect(preflight.single).not.toHaveBeenCalled();
    expect(write.single).toHaveBeenCalledOnce();
    expect(read.single).toHaveBeenCalledOnce();
    expect(write.select).toHaveBeenCalledWith('id');
    expect(preflight.eq).toHaveBeenCalledWith('merchant_id', 'm');
    expect(read.eq).toHaveBeenCalledWith('merchant_id', 'm');
    expect(mocks.revalidateStorefrontProducts).toHaveBeenCalledWith(
      [previous],
      'm'
    );
  });
  it.each([
    'stock',
    'status',
  ])('does not write %s without protected view access', async (action) => {
    const preflight = createUpdateQuery({ data: null, error: null });
    mocks.from.mockReturnValueOnce(preflight);
    await expect(run(action)).rejects.toThrow('Product is not accessible');
    expect(preflight.maybeSingle).toHaveBeenCalledOnce();
    expect(preflight.single).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateStorefrontProducts).not.toHaveBeenCalled();
  });
  it.each([
    'stock',
    'status',
  ])('preserves genuine %s preflight errors without writing', async (action) => {
    const preflight = createUpdateQuery({
      data: null,
      error: { message: 'permission denied for view merchant_products' },
    });
    mocks.from.mockReturnValueOnce(preflight);
    await expect(run(action)).rejects.toThrow(
      'permission denied for view merchant_products'
    );
    expect(preflight.maybeSingle).toHaveBeenCalledOnce();
    expect(preflight.single).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateStorefrontProducts).not.toHaveBeenCalled();
  });
  it.each([
    'stock',
    'status',
  ])('does not purge failed %s writes', async (action) => {
    mocks.from
      .mockReturnValueOnce(createUpdateQuery({ data: previous, error: null }))
      .mockReturnValueOnce(
        createUpdateQuery({ data: null, error: { message: 'write denied' } })
      );
    await expect(run(action)).rejects.toThrow('write denied');
    expect(mocks.revalidateStorefrontProducts).not.toHaveBeenCalled();
  });
  it.each([
    'stock',
    'status',
  ])('purges saved %s even when hydration errors', async (action) => {
    mocks.from
      .mockReturnValueOnce(createUpdateQuery({ data: previous, error: null }))
      .mockReturnValueOnce(
        createUpdateQuery({ data: { id: 'p' }, error: null })
      )
      .mockReturnValueOnce(
        createUpdateQuery({ data: null, error: { message: 'network error' } })
      );
    await expect(run(action)).rejects.toThrow('Product saved');
    expect(mocks.revalidateStorefrontProducts).toHaveBeenCalledWith(
      [previous],
      'm'
    );
  });
  it('purges saved stock even when hydration returns no row', async () => {
    mocks.from
      .mockReturnValueOnce(createUpdateQuery({ data: previous, error: null }))
      .mockReturnValueOnce(
        createUpdateQuery({ data: { id: 'p' }, error: null })
      )
      .mockReturnValueOnce(createUpdateQuery({ data: null, error: null }));
    await expect(run('stock')).rejects.toThrow('Product saved');
    expect(mocks.revalidateStorefrontProducts).toHaveBeenCalledWith(
      [previous],
      'm'
    );
  });
});
