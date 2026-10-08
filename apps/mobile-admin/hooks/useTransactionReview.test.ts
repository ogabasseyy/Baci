import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchTransactionReviewRows: vi.fn(),
  mapTransactionOrderRows: vi.fn(),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

vi.mock('@/lib/fetch-transaction-review-rows', () => ({
  fetchTransactionReviewRows: mocks.fetchTransactionReviewRows,
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
  it('preserves local-midnight instants and complete pagination through schema fallbacks', async () => {
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
          { exactDates: true, fetchAll: true }
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
          fetchAll: true,
        })
      );
    }
  });
});
