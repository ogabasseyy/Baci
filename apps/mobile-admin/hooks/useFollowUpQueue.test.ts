// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFollowUpQueue } from './useFollowUpQueue';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  refetchFailed: vi.fn(),
  useFailedOrders: vi.fn(),
  useMerchant: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@/hooks/useFailedOrders', () => ({
  useFailedOrders: mocks.useFailedOrders,
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
