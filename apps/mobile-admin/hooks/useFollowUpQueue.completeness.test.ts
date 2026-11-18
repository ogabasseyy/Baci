// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { oxygenProcessingOrder } from '@/test/fixtures/oxygen-follow-up';
import type { FailedOrder } from './useFailedOrders';
import { useFollowUpQueue } from './useFollowUpQueue';

const mocks = vi.hoisted(() => ({ standard: vi.fn(), oxygen: vi.fn() }));
vi.mock('./useFailedOrders', () => ({ useFailedOrders: mocks.standard }));
vi.mock('./useOxygenFollowUps', () => ({ useOxygenFollowUps: mocks.oxygen }));
vi.mock('./useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' }, isLoading: false }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const fallback = {
  ...oxygenProcessingOrder,
  oxygen_follow_up_status: undefined,
  payment_method: 'card',
  payment_status: 'failed' as const,
};
const result = {
  data: [fallback],
  isError: false,
  isIncomplete: false,
  isLimited: false,
  isFetching: false,
  isLoading: false,
  refetch: vi.fn(),
};

describe('merged follow-up completeness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.standard.mockReturnValue(result);
    mocks.oxygen.mockReturnValue({ ...result, data: [] });
  });
  it.each([
    'standard',
    'oxygen',
  ] as const)('warns when the %s source reaches its cap', (source) => {
    mocks[source].mockReturnValue({ ...result, isLimited: true });
    const { result: queue } = renderHook(() => useFollowUpQueue());
    expect(queue.current.isFailedOrdersError).toBe(false);
    expect(queue.current.isFollowUpLimited).toBe(true);
    expect(queue.current.viewState).toEqual({ status: 'ready' });
    expect(queue.current.failedOrders).toEqual([fallback]);
  });
  it('keeps standard failures visible if the provider projection fails', () => {
    mocks.oxygen.mockReturnValue({ ...result, data: undefined, isError: true });
    const { result: queue } = renderHook(() => useFollowUpQueue());
    expect(queue.current.failedOrders).toEqual([fallback]);
    expect(queue.current.isFailedOrdersError).toBe(true);
  });
  it('keeps the Oxygen review row authoritative over generic gateway context', () => {
    mocks.standard.mockReturnValue({
      ...result,
      data: [
        {
          ...fallback,
          attempt_count: 3,
          gateway_response: { message: 'Declined by ordinary gateway' },
        } satisfies FailedOrder,
      ],
    });
    const reviewed = {
      ...oxygenProcessingOrder,
      payment_method: 'card',
      payment_status: 'failed' as const,
      attempt_count: 1,
      oxygen_follow_up_status: 'needs_review' as const,
    } satisfies FailedOrder;
    mocks.oxygen.mockReturnValue({ ...result, data: [reviewed] });
    const { result: queue } = renderHook(() => useFollowUpQueue());
    expect(queue.current.failedOrders).toEqual([reviewed]);
  });
});
