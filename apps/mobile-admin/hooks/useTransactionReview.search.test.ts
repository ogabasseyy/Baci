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
