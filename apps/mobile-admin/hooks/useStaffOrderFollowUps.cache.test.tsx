import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  createWrapper,
  followUp,
  MERCHANT,
  ok,
  openRow,
  orderId,
  type QueryResult,
  queryBuilder,
  render,
  VIEWER,
} from '@/test/fixtures/staff-follow-up-hook';
import { useStaffOrderFollowUps } from './useStaffOrderFollowUps';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockImplementation(() => queryBuilder(ok([])).builder);
});

it('reuses a fresh open scan when checkout IDs change and refetches it on refresh', async () => {
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

it('finishes the save and discards an open scan requested before closing', async () => {
  const original = openRow(1);
  mocks.from.mockReturnValueOnce(queryBuilder(ok([original])).builder);
  const { result } = render();
  await waitFor(() => expect(result.current.openOrders).toHaveLength(1));
  let finishOldScan: (value: QueryResult) => void = () => undefined;
  const oldScan = new Promise<QueryResult>((resolve) => {
    finishOldScan = resolve;
  });
  let finishNewScan: (value: QueryResult) => void = () => undefined;
  const newScan = new Promise<QueryResult>((resolve) => {
    finishNewScan = resolve;
  });
  mocks.from
    .mockReturnValueOnce(queryBuilder(oldScan).builder)
    .mockReturnValueOnce(queryBuilder(newScan).builder);
  void result.current.refetch();
  await waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(2));
  mocks.rpc.mockResolvedValue(
    ok(followUp(1, { stage: 'closed', revision: 2 }))
  );

  await act(async () => {
    void result.current.save({
      type: 'update',
      fields: {
        order_id: orderId(1),
        revision: 1,
        stage: 'closed',
        outcome: '',
        follow_up_on: null,
      },
    });
  });
  await waitFor(() => expect(mocks.from).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(result.current.isSaving).toBe(false));
  expect(result.current.openOrders).toEqual([]);
  await act(async () => finishOldScan(ok([original])));
  expect(result.current.openOrders).toEqual([]);
  await act(async () => finishNewScan(ok([])));
});
