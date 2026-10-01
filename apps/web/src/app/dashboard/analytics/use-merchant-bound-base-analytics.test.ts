import { act, renderHook, waitFor } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsData } from '@/components/analytics/draggable-analytics-grid';

interface FetchRequest {
  setBaseAnalytics: Dispatch<SetStateAction<AnalyticsData | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadingAnalytics: Dispatch<SetStateAction<boolean>>;
}

const state = vi.hoisted(() => ({ requests: [] as FetchRequest[] }));

vi.mock('./fetch-base-analytics', () => ({
  fetchBaseAnalytics: (request: FetchRequest) => {
    state.requests.push(request);
    request.setLoadingAnalytics(true);
  },
}));

import { useMerchantBoundBaseAnalytics } from './use-merchant-bound-base-analytics';

describe('useMerchantBoundBaseAnalytics', () => {
  afterEach(() => {
    state.requests.length = 0;
  });

  it('clears the previous merchant snapshot before loading replacement analytics', async () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-07T00:00:00.000Z');
    const { result, rerender } = renderHook(
      ({ merchantId }: { merchantId: string }) =>
        useMerchantBoundBaseAnalytics({
          from,
          merchantId,
          refreshKey: 0,
          to,
        }),
      { initialProps: { merchantId: 'merchant-a' } }
    );

    await waitFor(() => expect(state.requests).toHaveLength(1));
    act(() => {
      state.requests[0].setBaseAnalytics({ revenueOverTime: [100] });
    });
    expect(result.current.data).toEqual({ revenueOverTime: [100] });

    rerender({ merchantId: 'merchant-b' });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(state.requests).toHaveLength(2));

    act(() => {
      state.requests[0].setBaseAnalytics({ revenueOverTime: [999] });
    });
    expect(result.current.data).toBeNull();

    act(() => {
      state.requests[1].setBaseAnalytics({ revenueOverTime: [200] });
    });
    expect(result.current.data).toEqual({ revenueOverTime: [200] });
  });

  it('exposes a request-bound error and clears it for a replacement merchant', async () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-07T00:00:00.000Z');
    const { result, rerender } = renderHook(
      ({ merchantId }: { merchantId: string }) =>
        useMerchantBoundBaseAnalytics({
          from,
          merchantId,
          refreshKey: 0,
          to,
        }),
      { initialProps: { merchantId: 'merchant-a' } }
    );

    await waitFor(() => expect(state.requests).toHaveLength(1));
    act(() => {
      state.requests[0].setError('Unable to load analytics. Please try again.');
    });
    await waitFor(() =>
      expect(result.current.error).toBe(
        'Unable to load analytics. Please try again.'
      )
    );

    rerender({ merchantId: 'merchant-b' });
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(state.requests).toHaveLength(2));

    act(() => {
      state.requests[0].setError('stale error');
    });
    expect(result.current.error).toBeNull();
  });
});
