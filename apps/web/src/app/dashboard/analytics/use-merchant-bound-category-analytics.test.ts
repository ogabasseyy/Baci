import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsCategory } from '@/components/analytics/analytics-category-nav';
import type { AnalyticsData } from '@/components/analytics/draggable-analytics-grid';

interface PendingRequest {
  reject: (error: unknown) => void;
  resolve: (data: Partial<AnalyticsData>) => void;
}

const state = vi.hoisted(() => ({ requests: [] as PendingRequest[] }));

vi.mock('./fetch-analytics-category-data', () => ({
  fetchAnalyticsCategoryData: () =>
    new Promise<Partial<AnalyticsData>>((resolve, reject) => {
      state.requests.push({ reject, resolve });
    }),
}));

import { useMerchantBoundCategoryAnalytics } from './use-merchant-bound-category-analytics';

const dates = {
  from: new Date('2026-08-01T00:00:00.000Z'),
  to: new Date('2026-08-07T00:00:00.000Z'),
};

describe('useMerchantBoundCategoryAnalytics', () => {
  afterEach(() => {
    state.requests.length = 0;
    vi.restoreAllMocks();
  });

  it('does not expose specialized data from a previous merchant or category', async () => {
    const { result, rerender } = renderHook(
      ({
        category,
        merchantId,
      }: {
        category: AnalyticsCategory;
        merchantId: string;
      }) =>
        useMerchantBoundCategoryAnalytics({
          allowed: true,
          category,
          ...dates,
          merchantId,
          refreshKey: 0,
        }),
      { initialProps: { category: 'ads', merchantId: 'merchant-a' } }
    );

    await waitFor(() => expect(state.requests).toHaveLength(1));
    act(() => {
      state.requests[0].resolve({ lowStockCount: 1 });
    });
    await waitFor(() =>
      expect(result.current.data).toEqual({ lowStockCount: 1 })
    );

    rerender({ category: 'inventory', merchantId: 'merchant-b' });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(state.requests).toHaveLength(2));

    act(() => {
      state.requests[0].resolve({ lowStockCount: 999 });
    });
    expect(result.current.data).toBeNull();

    act(() => {
      state.requests[1].resolve({ lowStockCount: 2 });
    });
    await waitFor(() =>
      expect(result.current.data).toEqual({ lowStockCount: 2 })
    );
  });

  it('clears loading when a range cannot start a request', async () => {
    const initialProps: { to: Date | undefined } = { to: dates.to };
    const { result, rerender } = renderHook(
      ({ to }: { to: Date | undefined }) =>
        useMerchantBoundCategoryAnalytics({
          allowed: true,
          category: 'ads',
          from: dates.from,
          merchantId: 'merchant-a',
          refreshKey: 0,
          to,
        }),
      { initialProps }
    );

    await waitFor(() => expect(state.requests).toHaveLength(1));
    expect(result.current.loading).toBe(true);

    rerender({ to: undefined });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it('exposes a current category error when the request fails before a snapshot exists', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useMerchantBoundCategoryAnalytics({
        allowed: true,
        category: 'ads',
        ...dates,
        merchantId: 'merchant-a',
        refreshKey: 0,
      })
    );

    await waitFor(() => expect(state.requests).toHaveLength(1));
    act(() => {
      state.requests[0].reject(new Error('provider unavailable'));
    });

    await waitFor(() =>
      expect(result.current.error).toBe(
        'Unable to load ads analytics. Please try again.'
      )
    );
    expect(result.current.data).toBeNull();
    consoleError.mockRestore();
  });
});
