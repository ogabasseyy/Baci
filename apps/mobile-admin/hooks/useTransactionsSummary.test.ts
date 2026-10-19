import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useMonthlyTransactionCount: vi.fn(),
  useTransactionReview: vi.fn(),
}));

vi.mock('@/hooks/useMonthlyTransactionCount', () => ({
  useMonthlyTransactionCount: mocks.useMonthlyTransactionCount,
}));

vi.mock('@/hooks/useTransactionReview', () => ({
  useTransactionReview: mocks.useTransactionReview,
}));

import { useTransactionsSummary } from './useTransactionsSummary';

const RANGE = {
  endDate: new Date(2026, 9, 31, 23, 59, 59, 999),
  startDate: new Date(2026, 9, 1),
};
const ANCHOR = new Date(2026, 9, 8, 12);

describe('useTransactionsSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useTransactionReview.mockReturnValue({
      data: [{ missingCostCount: 2 }, { missingCostCount: 3 }],
      error: null,
      isPending: false,
    });
    mocks.useMonthlyTransactionCount.mockReturnValue({
      data: 12,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('sums missing costs and reports the monthly count', () => {
    const { result } = renderHook(() => useTransactionsSummary(RANGE, ANCHOR));

    expect(result.current.summary).toEqual({
      missingCosts: 5,
      transactions: 12,
    });
    expect(mocks.useTransactionReview).toHaveBeenCalledWith(RANGE, {
      fetchAllRange: true,
    });
    expect(mocks.useMonthlyTransactionCount).toHaveBeenCalledWith(ANCHOR);
  });

  it('keeps the range query enabled so cost edits refresh the card', () => {
    // The card renders during search: a disabled query would ignore
    // cost-edit invalidations and show a pre-edit value until the search
    // clears. No enabled:false is ever passed.
    renderHook(() => useTransactionsSummary(RANGE, ANCHOR));

    expect(mocks.useTransactionReview).toHaveBeenCalledWith(RANGE, {
      fetchAllRange: true,
    });
    expect(mocks.useTransactionReview).not.toHaveBeenCalledWith(
      RANGE,
      expect.objectContaining({ enabled: false })
    );
  });

  it('shows a placeholder while the range summary is pending', () => {
    mocks.useTransactionReview.mockReturnValue({
      data: undefined,
      error: null,
      isPending: true,
    });

    const { result } = renderHook(() => useTransactionsSummary(RANGE, ANCHOR));

    expect(result.current.summary.missingCosts).toBe('--');
  });

  it('marks missing costs unavailable when the range query fails', () => {
    mocks.useTransactionReview.mockReturnValue({
      data: [],
      error: new Error('range boom'),
      isPending: false,
    });

    const { result } = renderHook(() => useTransactionsSummary(RANGE, ANCHOR));

    expect(result.current.summary.missingCosts).toBe('Unavailable');
  });

  it('marks transactions unavailable when the monthly count fails', () => {
    mocks.useMonthlyTransactionCount.mockReturnValue({
      data: undefined,
      error: new Error('count boom'),
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useTransactionsSummary(RANGE, ANCHOR));

    expect(result.current.summary.transactions).toBe('Unavailable');
  });

  it('marks the count with a plus when the range scan truncates', () => {
    mocks.useTransactionReview.mockReturnValue({
      data: [{ missingCostCount: 2 }, { missingCostCount: 3 }],
      error: null,
      isPending: false,
      searchTruncated: true,
    });

    const { result } = renderHook(() => useTransactionsSummary(RANGE, ANCHOR));

    expect(result.current.summary.missingCosts).toBe('5+');
  });

  it('exposes the monthly count refetch', () => {
    const refetch = vi.fn();
    mocks.useMonthlyTransactionCount.mockReturnValue({
      data: 12,
      error: null,
      refetch,
    });

    const { result } = renderHook(() => useTransactionsSummary(RANGE, ANCHOR));

    expect(result.current.refetchMonthlyCount).toBe(refetch);
  });

  it('exposes the range summary refetch', () => {
    const refetch = vi.fn();
    mocks.useTransactionReview.mockReturnValue({
      data: [],
      error: new Error('range boom'),
      isPending: false,
      refetch,
    });

    const { result } = renderHook(() => useTransactionsSummary(RANGE, ANCHOR));

    expect(result.current.refetchRangeSummary).toBe(refetch);
  });
});
