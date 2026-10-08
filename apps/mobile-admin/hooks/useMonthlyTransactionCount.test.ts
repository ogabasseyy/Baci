import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchTransactionReviewCount: vi.fn(),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

vi.mock('@/lib/fetch-transaction-review-count', () => ({
  fetchTransactionReviewCount: mocks.fetchTransactionReviewCount,
}));

import { useMonthlyTransactionCount } from './useMonthlyTransactionCount';

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

describe('useMonthlyTransactionCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchTransactionReviewCount.mockResolvedValue({
      count: 12,
      error: null,
    });
  });

  it('counts the full local calendar month', async () => {
    const { result } = renderHook(
      () => useMonthlyTransactionCount(new Date(2026, 9, 8, 12)),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toBe(12));
    expect(mocks.fetchTransactionReviewCount).toHaveBeenCalledWith({
      endDateIso: new Date(2026, 9, 31, 23, 59, 59, 999).toISOString(),
      merchantId: 'merchant-1',
      startDateIso: new Date(2026, 9, 1).toISOString(),
    });
  });

  it('rolls the month window over year boundaries', async () => {
    const { result } = renderHook(
      () => useMonthlyTransactionCount(new Date(2026, 11, 31, 12)),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toBe(12));
    expect(mocks.fetchTransactionReviewCount).toHaveBeenCalledWith({
      endDateIso: new Date(2026, 11, 31, 23, 59, 59, 999).toISOString(),
      merchantId: 'merchant-1',
      startDateIso: new Date(2026, 11, 1).toISOString(),
    });
  });

  it('surfaces count errors', async () => {
    mocks.fetchTransactionReviewCount.mockResolvedValue({
      count: null,
      error: { message: 'boom' },
    });
    const { result } = renderHook(
      () => useMonthlyTransactionCount(new Date(2026, 9, 8, 12)),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect((result.current.error as Error).message).toBe('boom');
  });
});
