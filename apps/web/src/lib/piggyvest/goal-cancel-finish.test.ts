import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ sweep: vi.fn(), amounts: vi.fn() }));
vi.mock('./goal-cancel-forfeit-runtime', () => ({
  sweepGoalCancelForfeit: mocks.sweep,
  withGoalCancelAmounts: mocks.amounts,
}));

import { finishGoalCancel } from './goal-cancel-finish';

const input = {
  store: {} as never,
  provider: { token: 't', baseUrl: 'https://example.test' },
  evidence: null,
  operationId: '33333333-3333-4333-8333-333333333333',
  allowForfeitTransfers: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.amounts.mockImplementation(async (_s, _id, result) => result);
});

it('hands the interest leg to the deferrer and answers without waiting for it', async () => {
  const deferForfeit = vi.fn();
  expect(
    await finishGoalCancel({ status: 'confirmed' }, { ...input, deferForfeit })
  ).toEqual({ status: 'confirmed' });
  expect(mocks.sweep).not.toHaveBeenCalled();
  expect(deferForfeit).toHaveBeenCalledOnce();
  await deferForfeit.mock.calls[0][0]();
  expect(mocks.sweep).toHaveBeenCalledOnce();
});

it('runs the leg inline when nothing can defer it', async () => {
  await finishGoalCancel({ status: 'confirmed' }, input);
  expect(mocks.sweep).toHaveBeenCalledOnce();
});

it('never starts the leg before the principal is confirmed, or while transfers are off', async () => {
  const deferForfeit = vi.fn();
  await finishGoalCancel({ status: 'pending' }, { ...input, deferForfeit });
  await finishGoalCancel(
    { status: 'confirmed' },
    { ...input, allowForfeitTransfers: false, deferForfeit }
  );
  expect(deferForfeit).not.toHaveBeenCalled();
  expect(mocks.sweep).not.toHaveBeenCalled();
});
