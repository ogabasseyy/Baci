import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  createWrapper,
  MERCHANT,
  ok,
  orderId,
  queryBuilder,
  VIEWER,
} from '@/test/fixtures/staff-follow-up-hook';
import { useStaffOrderFollowUps } from './useStaffOrderFollowUps';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));

it('reuses a fresh open scan when checkout IDs change and refetches it on refresh', async () => {
  mocks.from.mockImplementation(() => queryBuilder(ok([])).builder);
  const { rerender, result } = renderHook(
    ({ ids }) => useStaffOrderFollowUps(MERCHANT, VIEWER, ids),
    { initialProps: { ids: [orderId(1)] }, wrapper: createWrapper() }
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(mocks.from).toHaveBeenCalledTimes(2);

  rerender({ ids: [orderId(2)] });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(mocks.from).toHaveBeenCalledTimes(3);

  await act(() => result.current.refetch());
  expect(mocks.from).toHaveBeenCalledTimes(5);
});
