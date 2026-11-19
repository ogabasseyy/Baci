// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFollowUpQueue } from './useFollowUpQueue';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  refetchFailed: vi.fn(),
  refetchOxygen: vi.fn(),
  useFailedOrders: vi.fn(),
  useOxygenFollowUps: vi.fn(),
  useMerchant: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@/hooks/useFailedOrders', () => ({
  useFailedOrders: mocks.useFailedOrders,
}));
vi.mock('@/hooks/useOxygenFollowUps', () => ({
  useOxygenFollowUps: mocks.useOxygenFollowUps,
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: mocks.useMerchant,
}));

describe('useFollowUpQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useFailedOrders.mockReturnValue({
      data: undefined,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchFailed,
    });
    mocks.useOxygenFollowUps.mockReturnValue({
      data: undefined,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchOxygen,
    });
  });

  it('keeps follow-ups loading while merchant context is unresolved', () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isLoading: true,
      merchant: null,
    });

    const { result } = renderHook(() => useFollowUpQueue());

    expect(result.current.viewState).toEqual({ status: 'loading' });
  });

  it('refreshes merchant context without refetching a disabled queue', () => {
    mocks.useMerchant.mockReturnValue({
      error: new Error('merchant context failed'),
      isLoading: false,
      merchant: null,
    });

    const { result } = renderHook(() => useFollowUpQueue());

    result.current.refresh();

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['merchant'],
    });
    expect(mocks.refetchFailed).not.toHaveBeenCalled();
  });

  it('refetches Follow Up after invalidating merchant context when available', async () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isLoading: false,
      merchant: { id: 'merchant-1', payout_currency: 'NGN' },
    });

    const { result } = renderHook(() => useFollowUpQueue());

    await result.current.refresh();

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['merchant'],
    });
    expect(mocks.refetchFailed).toHaveBeenCalledTimes(1);
    expect(mocks.refetchOxygen).toHaveBeenCalledTimes(1);
  });

  it('shows distinct Oxygen orders alongside other follow-ups for the same customer', () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isLoading: false,
      merchant: { id: 'merchant-1' },
    });
    mocks.useFailedOrders.mockReturnValue({
      data: [
        {
          id: 'normal',
          customer_email: 'ada@example.com',
          created_at: '2026-11-17T08:00:00Z',
        },
      ],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchFailed,
    });
    mocks.useOxygenFollowUps.mockReturnValue({
      data: [
        {
          id: 'oxygen',
          customer_email: 'ada@example.com',
          created_at: '2026-11-17T09:00:00Z',
          oxygen_follow_up_status: 'oxygen_processing',
        },
      ],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchOxygen,
    });

    const { result } = renderHook(() => useFollowUpQueue());

    expect(result.current.failedOrders?.map((order) => order.id)).toEqual([
      'oxygen',
      'normal',
    ]);
  });

  it('orders follow-ups by time even when timestamps have different offsets', () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isLoading: false,
      merchant: { id: 'merchant-1' },
    });
    mocks.useFailedOrders.mockReturnValue({
      data: [{ id: 'newer', created_at: '2026-11-17T09:00:00Z' }],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchFailed,
    });
    mocks.useOxygenFollowUps.mockReturnValue({
      data: [{ id: 'older', created_at: '2026-11-17T10:00:00+02:00' }],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchOxygen,
    });

    const { result } = renderHook(() => useFollowUpQueue());
    expect(result.current.failedOrders?.map((item) => item.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('keeps the Oxygen review label when an order appears in both sources', () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isLoading: false,
      merchant: { id: 'merchant-1' },
    });
    mocks.useFailedOrders.mockReturnValue({
      data: [
        {
          id: 'same',
          created_at: '2026-11-17T08:00:00Z',
          payment_status: 'failed',
        },
      ],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchFailed,
    });
    mocks.useOxygenFollowUps.mockReturnValue({
      data: [
        {
          id: 'same',
          created_at: '2026-11-17T08:00:00Z',
          oxygen_follow_up_status: 'needs_review',
        },
      ],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchOxygen,
    });
    const { result } = renderHook(() => useFollowUpQueue());
    expect(result.current.failedOrders).toEqual([
      expect.objectContaining({
        id: 'same',
        oxygen_follow_up_status: 'needs_review',
      }),
    ]);
  });

  it('warns about an incomplete queue when Oxygen fails but other results load', () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isLoading: false,
      merchant: { id: 'merchant-1' },
    });
    mocks.useFailedOrders.mockReturnValue({
      data: [{ id: 'normal', created_at: '2026-11-17T08:00:00Z' }],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchFailed,
    });
    mocks.useOxygenFollowUps.mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchOxygen,
    });

    const { result } = renderHook(() => useFollowUpQueue());

    expect(result.current.viewState).toEqual({ status: 'ready' });
    expect(result.current.isFailedOrdersError).toBe(true);
  });

  it('does not claim the queue is empty when Oxygen follow-ups fail', () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isLoading: false,
      merchant: { id: 'merchant-1' },
    });
    mocks.useOxygenFollowUps.mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchOxygen,
    });

    const { result } = renderHook(() => useFollowUpQueue());

    expect(result.current.viewState.status).toBe('error');
  });

  it('keeps refresh progress active while cached merchant context revalidates', () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isFetching: true,
      isLoading: false,
      merchant: { id: 'merchant-1', payout_currency: 'NGN' },
    });

    const { result } = renderHook(() => useFollowUpQueue());

    expect(result.current.isRefreshing).toBe(true);
  });

  it('resolves and still refetches Follow Up when merchant invalidation rejects', async () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isLoading: false,
      merchant: { id: 'merchant-1', payout_currency: 'NGN' },
    });
    mocks.invalidateQueries.mockRejectedValue(
      new Error('merchant cache unavailable')
    );

    const { result } = renderHook(() => useFollowUpQueue());

    await expect(result.current.refresh()).resolves.toBeUndefined();

    expect(mocks.refetchFailed).toHaveBeenCalledTimes(1);
  });

  it('resolves when the Follow Up refetch rejects', async () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isLoading: false,
      merchant: { id: 'merchant-1', payout_currency: 'NGN' },
    });
    mocks.refetchFailed.mockRejectedValue(
      new Error('follow-up refetch failed')
    );

    const { result } = renderHook(() => useFollowUpQueue());

    await expect(result.current.refresh()).resolves.toBeUndefined();
    expect(mocks.refetchFailed).toHaveBeenCalledTimes(1);
  });
});
