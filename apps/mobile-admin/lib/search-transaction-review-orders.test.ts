import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mocks.rpc },
}));

describe('searchTransactionReviewOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns matching order ids for a multi-term query', async () => {
    const { searchTransactionReviewOrders } = await import(
      './search-transaction-review-orders'
    );
    mocks.rpc.mockResolvedValue({
      data: [{ order_id: 'order-1' }, { order_id: 'order-2' }],
      error: null,
    });

    const result = await searchTransactionReviewOrders({
      merchantId: 'merchant-1',
      search: ' 353232106161443  ada ',
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      'search_mobile_admin_transaction_review_orders',
      {
        p_limit: 100,
        p_merchant_id: 'merchant-1',
        p_terms: ['353232106161443', 'ada'],
      }
    );
    expect(result).toEqual({
      error: null,
      errorKind: null,
      orderIds: ['order-1', 'order-2'],
    });
  });

  it('skips the RPC for blank queries', async () => {
    const { searchTransactionReviewOrders } = await import(
      './search-transaction-review-orders'
    );

    const result = await searchTransactionReviewOrders({
      merchantId: 'merchant-1',
      search: '   ',
    });

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ error: null, errorKind: null, orderIds: [] });
  });

  it('drops malformed rows instead of failing the search', async () => {
    const { searchTransactionReviewOrders } = await import(
      './search-transaction-review-orders'
    );
    mocks.rpc.mockResolvedValue({
      data: [{ order_id: 'order-1' }, { order_id: null }, null],
      error: null,
    });

    const result = await searchTransactionReviewOrders({
      merchantId: 'merchant-1',
      search: 'ada',
    });

    expect(result).toEqual({
      error: null,
      errorKind: null,
      orderIds: ['order-1'],
    });
  });

  it('reports a missing function so callers can fall back', async () => {
    const { searchTransactionReviewOrders } = await import(
      './search-transaction-review-orders'
    );
    const error = {
      code: 'PGRST202',
      message:
        'Could not find the function public.search_mobile_admin_transaction_review_orders in the schema cache',
    };
    mocks.rpc.mockResolvedValue({ data: null, error });

    const result = await searchTransactionReviewOrders({
      merchantId: 'merchant-1',
      search: 'ada',
    });

    expect(result).toEqual({
      error,
      errorKind: 'missing-search-function',
      orderIds: [],
    });
  });

  it('reports other failures without the fallback kind', async () => {
    const { searchTransactionReviewOrders } = await import(
      './search-transaction-review-orders'
    );
    const error = { message: 'insufficient_privilege' };
    mocks.rpc.mockResolvedValue({ data: null, error });

    const result = await searchTransactionReviewOrders({
      merchantId: 'merchant-1',
      search: 'ada',
    });

    expect(result).toEqual({
      error,
      errorKind: 'search-failed',
      orderIds: [],
    });
  });
});
