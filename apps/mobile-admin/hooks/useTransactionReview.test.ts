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
  searchTransactionReviewOrders: mocks.searchTransactionReviewOrders,
}));

vi.mock('@/lib/transaction-review', () => ({
  buildTransactionReviewRangeFilters: () => ({}),
  mapTransactionOrderRows: mocks.mapTransactionOrderRows,
}));

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

describe('useTransactionReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mapTransactionOrderRows.mockImplementation((rows) => rows);
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [],
      error: null,
    });
  });

  it('does not map a returned order into transaction review results', async () => {
    mocks.fetchTransactionReviewRows.mockResolvedValueOnce({
      data: [
        {
          id: 'active-order',
          shipping_status: 'pending',
        },
        {
          id: 'returned-order',
          shipping_status: 'returned',
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useTransactionReview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(result.current.data).toEqual([
        {
          id: 'active-order',
          shipping_status: 'pending',
        },
      ])
    );

    expect(mocks.mapTransactionOrderRows).toHaveBeenCalledWith([
      {
        id: 'active-order',
        shipping_status: 'pending',
      },
    ]);
    expect(result.current.data).toEqual([
      {
        id: 'active-order',
        shipping_status: 'pending',
      },
    ]);
  });
  it('preserves exact date instants through schema fallbacks', async () => {
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'order_item_unit_costs' relationship in the schema cache",
        },
      })
      .mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(
      () =>
        useTransactionReview(
          {
            startDate: new Date('2026-09-30T23:00:00.000Z'),
            endDate: new Date('2026-10-08T22:59:59.999Z'),
          },
          { exactDates: true }
        ),
      { wrapper: createWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.fetchTransactionReviewRows.mock.calls.length).toBeGreaterThan(
      1
    );
    for (const [options] of mocks.fetchTransactionReviewRows.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({
          startDateIso: '2026-09-30T23:00:00.000Z',
          endDateIso: '2026-10-08T22:59:59.999Z',
        })
      );
    }
  });

  it('isolates cache entries when exactDates changes ISO semantics', async () => {
    const range = {
      endDate: new Date('2026-10-08T23:59:59.999Z'),
      startDate: new Date('2026-10-01T00:00:00.000Z'),
    };
    const { rerender, result } = renderHook(
      ({ exactDates }: { exactDates?: boolean }) =>
        useTransactionReview(range, { exactDates }),
      {
        initialProps: { exactDates: true as boolean | undefined },
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(1);

    rerender({ exactDates: undefined });

    await waitFor(() =>
      expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(2)
    );
  });

  it('hydrates only the orders matching the search', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: null,
      errorKind: null,
      orderIds: ['match-1', 'match-2'],
    });
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [{ id: 'match-1' }, { id: 'match-2' }],
      error: null,
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: ' 353232106161443 ' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() =>
      expect(result.current.data).toEqual([
        { id: 'match-1' },
        { id: 'match-2' },
      ])
    );
    expect(mocks.searchTransactionReviewOrders).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      search: '353232106161443',
    });
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledWith(
      expect.objectContaining({ orderIds: ['match-1', 'match-2'] })
    );
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

  it('falls back to a full scan when the search function is missing', async () => {
    mocks.searchTransactionReviewOrders.mockResolvedValue({
      error: { message: 'Could not find the function' },
      errorKind: 'missing-search-function',
      orderIds: [],
    });
    mocks.fetchTransactionReviewRows.mockResolvedValue({
      data: [{ id: 'legacy-match' }],
      error: null,
    });

    const { result } = renderHook(
      () => useTransactionReview(undefined, { search: 'ada' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() =>
      expect(result.current.data).toEqual([{ id: 'legacy-match' }])
    );
    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledWith(
      expect.objectContaining({ fetchAll: true })
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
