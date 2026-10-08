import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchTransactionReviewRows: vi.fn(),
  mapTransactionOrderRows: vi.fn(),
  searchTransactionReviewOrders: vi.fn(),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

vi.mock('@/lib/fetch-transaction-review-rows', () => ({
  fetchTransactionReviewRows: mocks.fetchTransactionReviewRows,
}));

vi.mock('@/lib/search-transaction-review-orders', () => ({
  TRANSACTION_REVIEW_SEARCH_LIMIT: 100,
  searchTransactionReviewOrders: mocks.searchTransactionReviewOrders,
}));

vi.mock('@/lib/transaction-review', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/transaction-review')>();
  return {
    buildTransactionReviewRangeFilters: () => ({}),
    filterTransactionOrders: actual.filterTransactionOrders,
    mapTransactionOrderRows: mocks.mapTransactionOrderRows,
  };
});

import { useTransactionReview } from './useTransactionReview';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe('useTransactionReview search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mapTransactionOrderRows.mockImplementation((rows) => rows);
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [],
      error: null,
    });
  });

  it('hydrates only the orders matching the search', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: null,
      errorKind: null,
      orderIds: ['match-1', 'match-2'],
    });
    const rows = [
      {
        cancelled_at: null,
        id: 'match-1',
        searchText: 'ord-1 353232106161443',
        shipping_status: 'pending',
      },
      {
        cancelled_at: null,
        id: 'match-2',
        searchText: 'ord-2 353232106161443',
        shipping_status: 'pending',
      },
    ];
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: rows,
      error: null,
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: ' 353232106161443 ' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toEqual(rows));
    expect(result.current.searchTruncated).toBe(false);
    expect(mocks.searchTransactionReviewOrders).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      search: '353232106161443',
    });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledWith(
      expect.objectContaining({ orderIds: ['match-1', 'match-2'] })
    );
  });

  it('discloses truncation when refinement shrinks an over-cap result', async () => {
    const orderIds = Array.from({ length: 101 }, (_, index) => `id-${index}`);
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: null,
      errorKind: null,
      orderIds,
    });
    const rows = Array.from({ length: 60 }, (_, index) => ({
      cancelled_at: null,
      id: `match-${index}`,
      searchText: '353232106161443',
      shipping_status: 'pending',
    }));
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: rows,
      error: null,
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: '353232106161443' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toEqual(rows));
    expect(result.current.searchTruncated).toBe(true);
  });

  it('refines RPC candidates to exact multi-term matches', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: null,
      errorKind: null,
      orderIds: ['match-1', 'partial-1'],
    });
    const fullMatch = {
      cancelled_at: null,
      id: 'match-1',
      searchText: 'ada 353232106161443',
      shipping_status: 'pending',
    };
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [
        fullMatch,
        {
          cancelled_at: null,
          id: 'partial-1',
          searchText: 'grace 353232106161443',
          shipping_status: 'pending',
        },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: 'ada 353232106161443' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toEqual([fullMatch]));
  });

  it('returns no orders without hydrating when nothing matches', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: null,
      errorKind: null,
      orderIds: [],
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: 'no-such-imei' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(mocks.fetchTransactionReviewRows).not.toHaveBeenCalled();
  });

  it('falls back to a filtered full scan when the search function is missing', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: { message: 'Could not find the function' },
      errorKind: 'missing-search-function',
      orderIds: [],
    });
    const legacyMatch = {
      cancelled_at: null,
      id: 'legacy-match',
      searchText: 'ada lovelace',
      shipping_status: 'pending',
    };
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [
        legacyMatch,
        {
          cancelled_at: null,
          id: 'legacy-other',
          searchText: 'grace hopper',
          shipping_status: 'pending',
        },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: 'ada' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toEqual([legacyMatch]));
    expect(result.current.searchTruncated).toBe(false);
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledWith(
      expect.objectContaining({ fetchAll: true })
    );
  });

  it('caps fallback results with a truncation signal', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: { message: 'Could not find the function' },
      errorKind: 'missing-search-function',
      orderIds: [],
    });
    const rows = Array.from({ length: 101 }, (_, index) => ({
      cancelled_at: null,
      id: `legacy-${index}`,
      searchText: 'ada',
      shipping_status: 'pending',
    }));
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: rows,
      error: null,
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: 'ada' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() =>
      expect(result.current.data).toEqual(rows.slice(0, 100))
    );
    expect(result.current.searchTruncated).toBe(true);
  });

  it('surfaces scan truncation when the capped fallback scan hits its limit', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: { message: 'Could not find the function' },
      errorKind: 'missing-search-function',
      orderIds: [],
    });
    const legacyMatch = {
      cancelled_at: null,
      id: 'legacy-match',
      searchText: 'ada lovelace',
      shipping_status: 'pending',
    };
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [legacyMatch],
      error: null,
      truncated: true,
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: 'ada' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toEqual([legacyMatch]));
    expect(result.current.searchTruncated).toBe(true);
  });

  it('hydrates only the ranked top-100 so hydration order cannot drop the best match', async () => {
    const rankedIds = Array.from(
      { length: 101 },
      (_, index) => `rank-${index}`
    );
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: null,
      errorKind: null,
      orderIds: rankedIds,
    });
    const rows = Array.from({ length: 100 }, (_, index) => ({
      cancelled_at: null,
      id: `rank-${index}`,
      searchText: 'ada lovelace',
      shipping_status: 'pending',
    }));
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: rows,
      error: null,
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: 'ada' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toEqual(rows));
    // The peek row detects truncation but is never hydrated: hydration
    // re-sorts null transaction dates last, so hydrating it would let the
    // display slice drop a recent null-date match.
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledWith(
      expect.objectContaining({ orderIds: rankedIds.slice(0, 100) })
    );
    expect(result.current.searchTruncated).toBe(true);
    expect(mocks.searchTransactionReviewOrders).toHaveBeenCalledTimes(1);
  });

  it('pages past complete-cost matches for a missing-costs tab search', async () => {
    const pageOneIds = Array.from(
      { length: 101 },
      (_, index) => `new-${index}`
    );
    mocks.searchTransactionReviewOrders.mockImplementation(
      ({ offset = 0 }: { offset?: number }) =>
        Promise.resolve({
          error: null,
          errorKind: null,
          orderIds: offset === 0 ? pageOneIds : ['old-missing'],
        })
    );
    const completeRow = (id: string) => ({
      cancelled_at: null,
      customerEmail: null,
      customerName: 'Ada',
      customerPhone: null,
      id,
      items: [
        { costPrice: 4000, id: `${id}-item`, profit: 100, searchText: 'ada' },
      ],
      missingCostCount: 0,
      orderNumber: id,
      paymentMethod: 'card',
      searchText: 'ada lovelace',
      shipping_status: 'pending',
    });
    const missingRow = {
      ...completeRow('old-missing'),
      items: [
        {
          costPrice: null,
          id: 'old-missing-item',
          profit: null,
          searchText: 'ada',
        },
      ],
      missingCostCount: 1,
    };
    mocks.fetchTransactionReviewRows.mockImplementation(
      ({ orderIds = [] }: { orderIds?: string[] }) =>
        Promise.resolve({
          data: orderIds.includes('old-missing')
            ? [missingRow]
            : pageOneIds.slice(0, 100).map(completeRow),
          error: null,
        })
    );

    const { result } = renderHook(
      () =>
        useTransactionReview(undefined, {
          search: 'ada',
          tab: 'missing-costs',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() =>
      expect(result.current.data?.map((order) => order.id)).toEqual([
        'old-missing',
      ])
    );
    expect(result.current.searchTruncated).toBe(false);
    expect(mocks.searchTransactionReviewOrders).toHaveBeenNthCalledWith(2, {
      merchantId: 'merchant-1',
      offset: 100,
      search: 'ada',
    });
  });

  it('stops tab paging at the page budget with a truncation signal', async () => {
    const pageIds = Array.from({ length: 101 }, (_, index) => `new-${index}`);
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: null,
      errorKind: null,
      orderIds: pageIds,
    });
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: pageIds.slice(0, 100).map((id) => ({
        cancelled_at: null,
        customerEmail: null,
        customerName: 'Ada',
        customerPhone: null,
        id,
        items: [
          { costPrice: 4000, id: `${id}-item`, profit: 100, searchText: 'ada' },
        ],
        missingCostCount: 0,
        orderNumber: id,
        paymentMethod: 'card',
        searchText: 'ada lovelace',
        shipping_status: 'pending',
      })),
      error: null,
    });

    const { result } = renderHook(
      () =>
        useTransactionReview(undefined, {
          search: 'ada',
          tab: 'missing-costs',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(result.current.searchTruncated).toBe(true);
    expect(mocks.searchTransactionReviewOrders).toHaveBeenCalledTimes(5);
    expect(mocks.searchTransactionReviewOrders).toHaveBeenNthCalledWith(5, {
      merchantId: 'merchant-1',
      offset: 400,
      search: 'ada',
    });
  });

  it('fails a tab search rather than presenting a partial page set', async () => {
    const pageIds = Array.from({ length: 101 }, (_, index) => `new-${index}`);
    mocks.searchTransactionReviewOrders.mockImplementation(
      ({ offset = 0 }: { offset?: number }) =>
        offset === 0
          ? Promise.resolve({ error: null, errorKind: null, orderIds: pageIds })
          : Promise.resolve({
              error: { message: 'boom' },
              errorKind: 'search-failed',
              orderIds: [],
            })
    );
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: pageIds.slice(0, 100).map((id) => ({
        cancelled_at: null,
        customerEmail: null,
        customerName: 'Ada',
        customerPhone: null,
        id,
        items: [
          { costPrice: 4000, id: `${id}-item`, profit: 100, searchText: 'ada' },
        ],
        missingCostCount: 0,
        orderNumber: id,
        paymentMethod: 'card',
        searchText: 'ada lovelace',
        shipping_status: 'pending',
      })),
      error: null,
    });

    const { result } = renderHook(
      () =>
        useTransactionReview(undefined, {
          search: 'ada',
          tab: 'missing-costs',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect((result.current.error as Error).message).toBe('boom');
  });

  it('refetches a search when the tab changes', async () => {
    const pageIds = Array.from({ length: 101 }, (_, index) => `new-${index}`);
    mocks.searchTransactionReviewOrders.mockImplementation(
      ({ offset = 0 }: { offset?: number }) =>
        Promise.resolve({
          error: null,
          errorKind: null,
          orderIds: offset === 0 ? pageIds : ['old-missing'],
        })
    );
    const row = (id: string, costPrice: number | null) => ({
      cancelled_at: null,
      customerEmail: null,
      customerName: 'Ada',
      customerPhone: null,
      id,
      items: [{ costPrice, id: `${id}-item`, profit: null, searchText: 'ada' }],
      missingCostCount: costPrice == null ? 1 : 0,
      orderNumber: id,
      paymentMethod: 'card',
      searchText: 'ada lovelace',
      shipping_status: 'pending',
    });
    mocks.fetchTransactionReviewRows.mockImplementation(
      ({ orderIds = [] }: { orderIds?: string[] }) =>
        Promise.resolve({
          data: orderIds.includes('old-missing')
            ? [row('old-missing', null)]
            : pageIds.slice(0, 100).map((id) => row(id, 4000)),
          error: null,
        })
    );

    const { result, rerender } = renderHook(
      ({ tab }: { tab: 'missing-costs' | 'paid' }) =>
        useTransactionReview(undefined, { search: 'ada', tab }),
      {
        wrapper: createWrapper(),
        initialProps: { tab: 'paid' as 'missing-costs' | 'paid' },
      }
    );

    await waitFor(() => expect(result.current.data).toHaveLength(100));
    expect(result.current.searchTruncated).toBe(true);

    rerender({ tab: 'missing-costs' });

    await waitFor(() =>
      expect(result.current.data?.map((order) => order.id)).toEqual([
        'old-missing',
      ])
    );
    expect(result.current.searchTruncated).toBe(false);
    expect(
      mocks.searchTransactionReviewOrders.mock.calls.some(
        ([args]) => (args as { offset?: number }).offset === 100
      )
    ).toBe(true);
  });

  it('filters the legacy fallback scan by tab before the display slice', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: { message: 'Could not find the function' },
      errorKind: 'missing-search-function',
      orderIds: [],
    });
    const row = (id: string, costPrice: number | null) => ({
      cancelled_at: null,
      customerEmail: null,
      customerName: 'Ada',
      customerPhone: null,
      id,
      items: [{ costPrice, id: `${id}-item`, profit: null, searchText: 'ada' }],
      missingCostCount: costPrice == null ? 1 : 0,
      orderNumber: id,
      paymentMethod: 'card',
      searchText: 'ada lovelace',
      shipping_status: 'pending',
    });
    const rows = [
      ...Array.from({ length: 100 }, (_, index) =>
        row(`complete-${index}`, 4000)
      ),
      row('legacy-missing', null),
    ];
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: rows,
      error: null,
    });

    const { result } = renderHook(
      () =>
        useTransactionReview(undefined, {
          search: 'ada',
          tab: 'missing-costs',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() =>
      expect(result.current.data?.map((order) => order.id)).toEqual([
        'legacy-missing',
      ])
    );
    expect(result.current.searchTruncated).toBe(false);
  });

  it('surfaces search failures', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: { message: 'insufficient_privilege' },
      errorKind: 'search-failed',
      orderIds: [],
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: 'ada' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect((result.current.error as Error).message).toBe(
      'insufficient_privilege'
    );
    expect(mocks.fetchTransactionReviewRows).not.toHaveBeenCalled();
  });
});
