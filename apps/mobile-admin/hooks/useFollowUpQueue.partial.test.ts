// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useFollowUpQueue } from './useFollowUpQueue';

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));
vi.mock('@/hooks/useFailedOrders', () => ({
  useFailedOrders: () => ({ data: [], isError: false }),
}));
vi.mock('@/hooks/useOxygenFollowUps', () => ({
  useOxygenFollowUps: () => ({
    data: [{ id: 'oxygen', created_at: '2026-11-17T08:00:00Z' }],
    isError: false,
    isIncomplete: true,
  }),
}));

it('warns when some Oxygen results were invalid but others are usable', () => {
  const { result } = renderHook(() => useFollowUpQueue());
  expect(result.current.failedOrders).toHaveLength(1);
  expect(result.current.viewState).toEqual({ status: 'ready' });
  expect(result.current.isFailedOrdersError).toBe(true);
});
