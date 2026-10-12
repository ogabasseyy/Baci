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
      id: `id-${index}`,
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

  it('restores RPC rank after hydration re-sorts null dates last', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: null,
      errorKind: null,
      orderIds: ['recent-null', 'older-dated'],
    });
    // Hydration returns null transaction dates last regardless of rank.
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [
        {
          cancelled_at: null,
          id: 'older-dated',
          searchText: 'ada lovelace',
          shipping_status: 'pending',
        },
        {
          cancelled_at: null,
          id: 'recent-null',
          searchText: 'ada lovelace',
          shipping_status: 'pending',
        },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: 'ada' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() =>
      expect(result.current.data?.map((order) => order.id)).toEqual([
        'recent-null',
        'older-dated',
      ])
    );
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
