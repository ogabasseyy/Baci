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

describe('useTransactionReview search paging budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mapTransactionOrderRows.mockImplementation((rows) => rows);
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [],
      error: null,
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
});
