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

describe('useTransactionReview schema fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mapTransactionOrderRows.mockImplementation((rows) => rows);
  });

  it('keeps timestamp cancellation filtering after a full schema fallback', async () => {
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'order_item_unit_costs' relationship in the schema cache",
        },
      })
      .mockResolvedValueOnce({
        data: [
          {
            cancelled_at: '2026-07-21T00:00:00.000Z',
            id: 'cancelled-order',
            shipping_status: 'pending',
          },
        ],
        error: null,
      });

    const { result } = renderHook(() => useTransactionReview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual([]));

    expect(mocks.fetchTransactionReviewRows).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        selectStatement: expect.stringContaining('assurance_fee'),
      })
    );
    expect(mocks.fetchTransactionReviewRows).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        includeCancelledAt: true,
        selectStatement: expect.stringContaining('cancelled_at'),
      })
    );
    expect(mocks.mapTransactionOrderRows).toHaveBeenCalledWith([]);
    expect(result.current.data).toEqual([]);
  });

  it('immediately loads legacy orders without discount_amount', async () => {
    const missingDiscountError = {
      code: 'PGRST204',
      message:
        "Could not find the 'discount_amount' column of 'orders' in the schema cache",
    };
    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: missingDiscountError })
      .mockResolvedValueOnce({
        data: [{ id: 'legacy-order' }],
        error: null,
      });

    const { result } = renderHook(() => useTransactionReview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(result.current.data).toEqual([{ id: 'legacy-order' }])
    );

    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(2);
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[1][0].selectStatement
    ).not.toContain('discount_amount');
    expect(mocks.fetchTransactionReviewRows).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        includeCancelledAt: true,
        includeTransactionDate: true,
      })
    );
    expect(mocks.mapTransactionOrderRows).toHaveBeenCalledWith([
      { id: 'legacy-order' },
    ]);
  });

  it('omits discounts when only the minimal base schema fallback is available', async () => {
    const schemaCacheError = {
      code: 'PGRST200',
      message:
        "Could not find the 'order_item_unit_costs' relationship in the schema cache",
    };
    const baseOrder = {
      id: 'base-order',
      order_items: [{ id: 'base-item', price: 100, quantity: 1 }],
      shipping_status: 'pending',
      total: 100,
    };

    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: schemaCacheError })
      .mockResolvedValueOnce({ data: null, error: schemaCacheError })
      .mockResolvedValueOnce({ data: null, error: schemaCacheError })
      .mockResolvedValueOnce({ data: null, error: schemaCacheError })
      .mockResolvedValueOnce({ data: [baseOrder], error: null });

    const { result } = renderHook(() => useTransactionReview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual([baseOrder]));

    expect(mocks.fetchTransactionReviewRows).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        selectStatement: expect.not.stringContaining('discount_amount'),
      })
    );
    expect(mocks.mapTransactionOrderRows).toHaveBeenCalledWith([baseOrder]);
  });

  it('keeps discounts in the compatible base projection after newer selectors fail', async () => {
    const schemaCacheError = {
      code: 'PGRST200',
      message:
        "Could not find the 'transaction_date' column of 'orders' in the schema cache",
    };
    const richProjectionSchemaError = {
      code: 'PGRST200',
      message:
        "Could not find the 'order_item_unit_costs' relationship in the schema cache",
    };
    const discountedOrder = {
      discount_amount: 25,
      id: 'discounted-base-order',
      order_items: [{ id: 'base-item', price: 100, quantity: 1 }],
      shipping_status: 'pending',
      source: 'online_store',
      total: 75,
    };

    mocks.fetchTransactionReviewRows
      .mockResolvedValueOnce({ data: null, error: schemaCacheError })
      .mockResolvedValueOnce({ data: null, error: richProjectionSchemaError })
      .mockResolvedValueOnce({ data: null, error: schemaCacheError })
      .mockResolvedValueOnce({ data: null, error: schemaCacheError })
      .mockResolvedValueOnce({ data: [discountedOrder], error: null });

    const { result } = renderHook(() => useTransactionReview(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual([discountedOrder]));

    expect(mocks.fetchTransactionReviewRows).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        includeCancelledAt: true,
        includeTransactionDate: false,
        selectStatement: expect.stringContaining('discount_amount'),
      })
    );
    expect(mocks.mapTransactionOrderRows).toHaveBeenCalledWith([
      discountedOrder,
    ]);
  });

  it('omits line_id after a schema-cache failure while retaining discount fields', async () => {
    const lineIdSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'line_id' column of 'order_items' in the schema cache",
    };
    const discountedOrder = {
      discount_amount: 25,
      id: 'discounted-no-line-id-order',
      order_items: [
        {
          product_id: 'product-1',
          price: 100,
          quantity: 1,
          variant_id: null,
        },
      ],
      source: 'online_store',
      total: 75,
    };

    mocks.fetchTransactionReviewRows.mockResolvedValueOnce({
      data: null,
      error: lineIdSchemaError,
    });
    mocks.fetchTransactionReviewRows.mockResolvedValueOnce({
      data: [discountedOrder],
      error: null,
    });

    const { result } = renderHook(() => useTransactionReview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual([discountedOrder]));

    expect(mocks.fetchTransactionReviewRows).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        selectStatement: expect.stringContaining('discount_amount'),
      })
    );
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[1][0].selectStatement
    ).not.toContain('order_items(id, line_id');
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[1][0].selectStatement
    ).toContain('order_item_unit_costs');
    expect(
      mocks.fetchTransactionReviewRows.mock.calls[1][0].selectStatement
    ).toContain('product_variants');
  });
});
