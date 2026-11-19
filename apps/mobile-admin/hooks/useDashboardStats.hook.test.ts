// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refetchChart: vi.fn(),
  refetchStats: vi.fn(),
  refetchTopProducts: vi.fn(),
  skipToken: Symbol('skipToken'),
  useMerchant: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  skipToken: mocks.skipToken,
  useQuery: mocks.useQuery,
}));

vi.mock('./dashboard-revenue-chart', () => ({
  fetchRevenueChart: vi.fn(),
}));

vi.mock('./dashboard-stats-fetch', () => ({
  fetchDashboardStats: vi.fn(),
}));

vi.mock('./dashboard-top-products', () => ({
  fetchTopProducts: vi.fn(),
}));

vi.mock('./useBranchScope', () => ({
  useBranchScope: () => ({ scope: { type: 'all' } }),
}));

vi.mock('./useMerchant', () => ({
  useMerchant: mocks.useMerchant,
}));

import { useDashboardStats } from './useDashboardStats';

describe('useDashboardStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useMerchant.mockReturnValue({ merchant: null });
    mocks.useQuery.mockImplementation((config: { queryKey: string[] }) => ({
      data: undefined,
      error: null,
      isLoading: false,
      refetch:
        config.queryKey[0] === 'dashboard-stats'
          ? mocks.refetchStats
          : config.queryKey[0] === 'revenue-chart'
            ? mocks.refetchChart
            : mocks.refetchTopProducts,
    }));
  });

  it('does not manually refetch disabled queries without a merchant', () => {
    const { result } = renderHook(() => useDashboardStats());
    const queryConfigs = mocks.useQuery.mock.calls.map(([config]) => config);

    result.current.refetch();

    expect(queryConfigs).toHaveLength(3);
    expect(queryConfigs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ enabled: false, queryFn: mocks.skipToken }),
      ])
    );
    expect(queryConfigs.every((config) => config.enabled === false)).toBe(true);
    expect(
      queryConfigs.every((config) => config.queryFn === mocks.skipToken)
    ).toBe(true);
    expect(mocks.refetchStats).not.toHaveBeenCalled();
    expect(mocks.refetchChart).not.toHaveBeenCalled();
    expect(mocks.refetchTopProducts).not.toHaveBeenCalled();
  });

  it('delegates aggregate refetching to every query for a merchant', () => {
    mocks.useMerchant.mockReturnValue({ merchant: { id: 'merchant-1' } });

    const { result } = renderHook(() => useDashboardStats());
    const queryConfigs = mocks.useQuery.mock.calls.map(([config]) => config);

    result.current.refetch();

    expect(queryConfigs.every((config) => config.enabled === true)).toBe(true);
    expect(
      queryConfigs.every((config) => typeof config.queryFn === 'function')
    ).toBe(true);
    expect(mocks.refetchStats).toHaveBeenCalledTimes(1);
    expect(mocks.refetchChart).toHaveBeenCalledTimes(1);
    expect(mocks.refetchTopProducts).toHaveBeenCalledTimes(1);
  });

  it('exposes dashboard query errors', () => {
    const statsError = new Error('Dashboard unavailable');
    mocks.useQuery.mockImplementation((config: { queryKey: string[] }) => ({
      data: undefined,
      error: config.queryKey[0] === 'dashboard-stats' ? statsError : null,
      isLoading: false,
      refetch:
        config.queryKey[0] === 'dashboard-stats'
          ? mocks.refetchStats
          : config.queryKey[0] === 'revenue-chart'
            ? mocks.refetchChart
            : mocks.refetchTopProducts,
    }));

    const { result } = renderHook(() => useDashboardStats());

    expect(result.current.error).toBe(statsError);
  });
});
