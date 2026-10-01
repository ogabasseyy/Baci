import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/sanitize', () => ({
  sanitizeSearchQuery: (value: string) => value.trim(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { fetchAdminProductSearchRows } from './product-search';

function createQueryChain(result: {
  data?: unknown;
  error?: { message: string } | null;
}) {
  return {
    data: result.data ?? null,
    error: result.error ?? null,
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
  };
}

describe('admin product search helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches ranked admin product rows through the shared search rpc', async () => {
    const query = createQueryChain({
      data: [
        { id: 'prod-2', name: 'iPhone 14 Pro Max' },
        { id: 'prod-1', name: 'iPhone 14 Pro' },
      ],
    });

    mockRpc.mockResolvedValue({
      data: [
        { product_id: 'prod-1', relevance: 9.5, total_count: 2 },
        { product_id: 'prod-2', relevance: 8.9, total_count: 2 },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    const result = await fetchAdminProductSearchRows({
      cursor: 0,
      filters: {
        search: 'iphone14promax',
        status: 'active',
      },
      merchantId: 'merchant-1',
      pageSize: 20,
      selectColumns: 'id, name',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        merchant_id_param: 'merchant-1',
        parent_only: true,
        search_query: 'iphone14promax',
        status_filter: 'active',
      })
    );
    expect(query.select).toHaveBeenCalledWith('id, name');
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(query.is).toHaveBeenCalledWith('parent_product_id', null);
    expect(query.in).toHaveBeenCalledWith('id', ['prod-1', 'prod-2']);
    expect(result).toEqual({
      nextCursor: null,
      rows: [
        { id: 'prod-1', name: 'iPhone 14 Pro' },
        { id: 'prod-2', name: 'iPhone 14 Pro Max' },
      ],
      totalCount: 2,
    });
  });

  it('passes admin effective stock filters to ranked search results', async () => {
    const query = createQueryChain({
      data: [
        {
          id: 'prod-legacy',
          name: 'Legacy Stock Phone',
          stock: 12,
          stock_quantity: 0,
        },
      ],
    });

    mockRpc.mockResolvedValue({
      data: [{ product_id: 'prod-legacy', relevance: 9.5, total_count: 1 }],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    const result = await fetchAdminProductSearchRows({
      cursor: 0,
      filters: {
        search: 'legacy stock',
        stockFilter: 'in_stock',
      },
      merchantId: 'merchant-1',
      pageSize: 20,
      selectColumns: 'id, name, stock, stock_quantity',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        search_query: 'legacy stock',
        status_filter: 'not_archived',
        stock_filter: 'admin_in_stock',
      })
    );
    expect(query.or).toHaveBeenCalledTimes(1);
    expect(query.or).toHaveBeenCalledWith(
      'and(status.neq.archived,stock_quantity.gt.0),and(status.neq.archived,stock_quantity.is.null,stock.gt.0),and(status.neq.archived,stock_quantity.lte.0,stock.gt.0),and(status.is.null,stock_quantity.gt.0),and(status.is.null,stock_quantity.is.null,stock.gt.0),and(status.is.null,stock_quantity.lte.0,stock.gt.0)'
    );
    expect(query.eq).toHaveBeenCalledWith('manage_stock', true);
    expect(result.rows).toEqual([
      {
        id: 'prod-legacy',
        name: 'Legacy Stock Phone',
        stock: 12,
        stock_quantity: 0,
      },
    ]);
  });

  it('excludes archived products from stock search results by default', async () => {
    const query = createQueryChain({ data: [] });

    mockRpc.mockResolvedValue({
      data: [{ product_id: 'prod-archived', relevance: 9.5, total_count: 1 }],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    await fetchAdminProductSearchRows({
      cursor: 0,
      filters: {
        search: 'old phone',
        stockFilter: 'out_of_stock',
      },
      merchantId: 'merchant-1',
      pageSize: 20,
      selectColumns: 'id, name',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        status_filter: 'not_archived',
        stock_filter: 'admin_out_of_stock',
      })
    );
    expect(query.or).toHaveBeenCalledTimes(1);
    expect(query.or).toHaveBeenCalledWith(
      'and(status.neq.archived,stock_quantity.is.null,stock.is.null),and(status.neq.archived,stock_quantity.is.null,stock.lte.0),and(status.neq.archived,stock_quantity.lte.0,stock.is.null),and(status.neq.archived,stock_quantity.lte.0,stock.lte.0),and(status.is.null,stock_quantity.is.null,stock.is.null),and(status.is.null,stock_quantity.is.null,stock.lte.0),and(status.is.null,stock_quantity.lte.0,stock.is.null),and(status.is.null,stock_quantity.lte.0,stock.lte.0)'
    );
    expect(query.eq).toHaveBeenCalledWith('manage_stock', true);
  });

  it('excludes archived products from default product search results', async () => {
    const query = createQueryChain({
      data: [{ id: 'prod-archived', name: 'Samsung Galaxy A07 4GB 128GB' }],
    });
    query.or.mockImplementation(() => {
      query.data = [];
      return query;
    });

    mockRpc.mockResolvedValue({
      data: [{ product_id: 'prod-archived', relevance: 9.5, total_count: 1 }],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    const result = await fetchAdminProductSearchRows({
      cursor: 0,
      filters: { search: 'a07' },
      merchantId: 'merchant-1',
      pageSize: 20,
      selectColumns: 'id, name',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ status_filter: 'not_archived' })
    );
    expect(query.or).toHaveBeenCalledWith('status.neq.archived,status.is.null');
    expect(result.rows).toEqual([]);
  });

  it('keeps archived products available to historical reconciliation searches', async () => {
    const query = createQueryChain({
      data: [{ id: 'prod-archived', name: 'Samsung Galaxy A07 4GB 128GB' }],
    });

    mockRpc.mockResolvedValue({
      data: [{ product_id: 'prod-archived', relevance: 9.5, total_count: 1 }],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    const result = await fetchAdminProductSearchRows({
      cursor: 0,
      filters: { includeArchived: true, search: 'a07' },
      merchantId: 'merchant-1',
      pageSize: 20,
      selectColumns: 'id, name',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ status_filter: null })
    );
    expect(query.or).not.toHaveBeenCalledWith(
      'status.neq.archived,status.is.null'
    );
    expect(result.rows).toEqual([
      { id: 'prod-archived', name: 'Samsung Galaxy A07 4GB 128GB' },
    ]);
  });

  it('keeps legacy null-status products in default search results', async () => {
    const query = createQueryChain({
      data: [{ id: 'prod-legacy', name: 'Legacy Phone', status: null }],
    });

    mockRpc.mockResolvedValue({
      data: [{ product_id: 'prod-legacy', relevance: 9.5, total_count: 1 }],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    const result = await fetchAdminProductSearchRows({
      cursor: 0,
      filters: { search: 'legacy phone' },
      merchantId: 'merchant-1',
      pageSize: 20,
      selectColumns: 'id, name',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({ status_filter: 'not_archived' })
    );
    expect(query.or).toHaveBeenCalledWith('status.neq.archived,status.is.null');
    expect(result.rows).toEqual([
      { id: 'prod-legacy', name: 'Legacy Phone', status: null },
    ]);
  });
});
