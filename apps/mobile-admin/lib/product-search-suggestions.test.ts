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

import {
  fetchAdminProductSearchRows,
  fetchAdminProductSuggestionCandidates,
} from './product-search';

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

describe('admin product search suggestion helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches suggestion candidates in rpc rank order and excludes the current product', async () => {
    const query = createQueryChain({
      data: [
        { id: 'prod-3', name: 'iPhone 14 Pro Max' },
        { id: 'prod-2', name: 'iPhone 14 Pro' },
      ],
    });

    mockRpc.mockResolvedValue({
      data: [
        { product_id: 'prod-1', relevance: 9.8, total_count: 3 },
        { product_id: 'prod-3', relevance: 9.1, total_count: 3 },
        { product_id: 'prod-2', relevance: 8.7, total_count: 3 },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    const result = await fetchAdminProductSuggestionCandidates({
      excludeProductId: 'prod-1',
      limit: 2,
      merchantId: 'merchant-1',
      productName: 'iphone 14 pro max',
      selectColumns: 'id, name',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        parent_only: true,
        result_limit: 12,
        search_query: 'iphone 14 pro max',
      })
    );
    expect(result).toEqual([
      { id: 'prod-3', name: 'iPhone 14 Pro Max' },
      { id: 'prod-2', name: 'iPhone 14 Pro' },
    ]);
  });

  it('throws when ranked admin product search rpc fails', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'rpc failed' },
    });

    await expect(
      fetchAdminProductSearchRows({
        cursor: 0,
        filters: { search: 'iphone 14' },
        merchantId: 'merchant-1',
        pageSize: 20,
        selectColumns: 'id, name',
      })
    ).rejects.toThrow('rpc failed');
  });

  it('throws when ranked admin product row lookup fails', async () => {
    const query = createQueryChain({
      data: null,
      error: { message: 'row fetch failed' },
    });

    mockRpc.mockResolvedValue({
      data: [{ product_id: 'prod-1', relevance: 9.5, total_count: 1 }],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    await expect(
      fetchAdminProductSearchRows({
        cursor: 0,
        filters: { search: 'iphone 14' },
        merchantId: 'merchant-1',
        pageSize: 20,
        selectColumns: 'id, name',
      })
    ).rejects.toThrow('row fetch failed');
  });

  it('throws when suggestion rpc fails', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'suggestion rpc failed' },
    });

    await expect(
      fetchAdminProductSuggestionCandidates({
        excludeProductId: 'prod-1',
        limit: 2,
        merchantId: 'merchant-1',
        productName: 'iphone 14 pro max',
        selectColumns: 'id, name',
      })
    ).rejects.toThrow('suggestion rpc failed');
  });

  it('throws when suggestion row lookup fails', async () => {
    const query = createQueryChain({
      data: null,
      error: { message: 'suggestion rows failed' },
    });

    mockRpc.mockResolvedValue({
      data: [{ product_id: 'prod-3', relevance: 9.1, total_count: 1 }],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    await expect(
      fetchAdminProductSuggestionCandidates({
        excludeProductId: 'prod-1',
        limit: 2,
        merchantId: 'merchant-1',
        productName: 'iphone 14 pro max',
        selectColumns: 'id, name',
      })
    ).rejects.toThrow('suggestion rows failed');
  });
});
