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

describe('useTransactionReview variant schema fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mapTransactionOrderRows.mockImplementation((rows) => rows);
  });

  it('omits variant_id after a schema-cache failure while retaining review rows', async () => {
    const variantIdSchemaError = {
      code: 'PGRST204',
      message:
        "Could not find the 'variant_id' column of 'order_items' in the schema cache",
    };
    const legacyOrder = {
      id: 'legacy-variant-order',
      order_items: [
        {
          product_id: 'product-1',
          price: 100,
          quantity: 1,
        },
      ],
      total: 100,
    };

    const failedAttempts = 12;
    for (let attempt = 0; attempt < failedAttempts; attempt += 1) {
      mocks.fetchTransactionReviewRows.mockResolvedValueOnce({
        data: null,
        error: variantIdSchemaError,
      });
    }
    mocks.fetchTransactionReviewRows.mockResolvedValueOnce({
      data: [legacyOrder],
      error: null,
    });

    const { result } = renderHook(() => useTransactionReview(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual([legacyOrder]));

    expect(mocks.fetchTransactionReviewRows).toHaveBeenCalledTimes(
      failedAttempts + 1
    );
    expect(
      mocks.fetchTransactionReviewRows.mock.lastCall?.[0].selectStatement
    ).not.toContain('variant_id');
  });
});
