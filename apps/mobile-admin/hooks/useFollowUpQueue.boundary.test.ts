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

  it('keeps deterministic descending order even when an entry has an invalid timestamp', () => {
    mocks.useMerchant.mockReturnValue({
      error: null,
      isLoading: false,
      merchant: { id: 'merchant-1' },
    });
    mocks.useFailedOrders.mockReturnValue({
      data: [
        { id: 'older', created_at: '2026-11-17T08:00:00Z' },
        { id: 'broken-a', created_at: 'not-a-date' },
      ],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchFailed,
    });
    mocks.useOxygenFollowUps.mockReturnValue({
      data: [
        { id: 'broken-b', created_at: 'also-invalid' },
        { id: 'newer', created_at: '2026-11-17T10:00:00Z' },
      ],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mocks.refetchOxygen,
    });

    const { result } = renderHook(() => useFollowUpQueue());

    expect(result.current.failedOrders?.map((order) => order.id)).toEqual([
      'newer',
      'older',
      'broken-a',
      'broken-b',
    ]);
  });
});
