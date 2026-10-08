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

describe('useTransactionReview search tab paging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mapTransactionOrderRows.mockImplementation((rows) => rows);
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [],
      error: null,
    });
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

  it('refines the missing-cost items the tab keeps, not the ones it strips', async () => {
    const pageOneIds = Array.from(
      { length: 101 },
      (_, index) => `new-${index}`
    );
    mocks.searchTransactionReviewOrders.mockImplementation(
      ({ offset = 0 }: { offset?: number }) =>
        Promise.resolve({
          error: null,
          errorKind: null,
          orderIds: offset === 0 ? pageOneIds : ['old-genuine'],
        })
    );
    // Mixed order: the complete-cost item matches, but the missing-cost
    // item (and the order scalars) do not. Refining before the tab would
    // accept it and consume cap space; refining after drops it.
    const mixedRow = (id: string) => ({
      cancelled_at: null,
      customerEmail: null,
      customerName: 'Zed',
      customerPhone: null,
      id,
      items: [
        {
          costPrice: 4000,
          id: `${id}-complete`,
          profit: 100,
          searchText: 'ada widget',
        },
        {
          costPrice: null,
          id: `${id}-missing`,
          profit: null,
          searchText: 'zzz gadget',
        },
      ],
      missingCostCount: 1,
      orderNumber: id,
      paymentMethod: 'card',
      searchText: 'zed ada widget zzz gadget',
      shipping_status: 'pending',
    });
    const genuineRow = {
      ...mixedRow('old-genuine'),
      customerName: 'Zed',
      items: [
        {
          costPrice: null,
          id: 'old-genuine-missing',
          profit: null,
          searchText: 'ada gadget',
        },
      ],
      searchText: 'zed ada gadget',
    };
    mocks.fetchTransactionReviewRows.mockImplementation(
      ({ orderIds = [] }: { orderIds?: string[] }) =>
        Promise.resolve({
          data: orderIds.includes('old-genuine')
            ? [genuineRow]
            : pageOneIds.slice(0, 100).map(mixedRow),
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
        'old-genuine',
      ])
    );
    expect(result.current.searchTruncated).toBe(false);
    expect(mocks.searchTransactionReviewOrders).toHaveBeenCalledTimes(2);
  });
});
