import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  afterEach(() => {
    act(() => {
      focusManager.setFocused(true);
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

  it('anchors the month to local midnight when UTC disagrees', async () => {
    // 00:30 on Oct 1 in UTC+ zones is still Sep 30 in UTC: the window must
    // follow the device calendar, not UTC day boundaries.
    const { result } = renderHook(
      () => useMonthlyTransactionCount(new Date(2026, 9, 1, 0, 30)),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toBe(12));
    const { endDateIso, startDateIso } =
      mocks.fetchTransactionReviewCount.mock.calls[0][0];
    const start = new Date(startDateIso);
    const end = new Date(endDateIso);
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([
      2026, 9, 1,
    ]);
    expect([
      end.getFullYear(),
      end.getMonth(),
      end.getDate(),
      end.getHours(),
      end.getMinutes(),
    ]).toEqual([2026, 9, 31, 23, 59]);
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

  it('refetches a fresh count when the app regains focus', async () => {
    const { result } = renderHook(
      () => useMonthlyTransactionCount(new Date(2026, 9, 8, 12)),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.data).toBe(12));
    expect(mocks.fetchTransactionReviewCount).toHaveBeenCalledTimes(1);

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() =>
      expect(mocks.fetchTransactionReviewCount).toHaveBeenCalledTimes(2)
    );
  });
});
