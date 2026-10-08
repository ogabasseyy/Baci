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

describe('useTransactionReview search fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mapTransactionOrderRows.mockImplementation((rows) => rows);
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [],
      error: null,
    });
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

  it('drops mixed fallback orders whose missing items do not match', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: { message: 'Could not find the function' },
      errorKind: 'missing-search-function',
      orderIds: [],
    });
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [
        {
          cancelled_at: null,
          customerEmail: null,
          customerName: 'Zed',
          customerPhone: null,
          id: 'legacy-mixed',
          items: [
            {
              costPrice: 4000,
              id: 'legacy-mixed-complete',
              profit: 100,
              searchText: 'ada widget',
            },
            {
              costPrice: null,
              id: 'legacy-mixed-missing',
              profit: null,
              searchText: 'zzz gadget',
            },
          ],
          missingCostCount: 1,
          orderNumber: 'legacy-mixed',
          paymentMethod: 'card',
          searchText: 'zed ada widget zzz gadget',
          shipping_status: 'pending',
        },
      ],
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
    expect(result.current.searchTruncated).toBe(false);
  });
});
