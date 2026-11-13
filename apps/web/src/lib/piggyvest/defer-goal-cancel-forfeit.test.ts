import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const after = vi.hoisted(() => vi.fn());
vi.mock('next/server', () => ({ after }));

import { deferGoalCancelForfeit } from './defer-goal-cancel-forfeit';

beforeEach(() => vi.clearAllMocks());

it('schedules the interest leg after the response instead of running it now', async () => {
  const task = vi.fn().mockResolvedValue('confirmed');
  deferGoalCancelForfeit(task);
  expect(task).not.toHaveBeenCalled();
  expect(after).toHaveBeenCalledOnce();
  await after.mock.calls[0][0]();
  expect(task).toHaveBeenCalledOnce();
});

it('never lets a failing interest leg throw out of the deferred task', async () => {
  deferGoalCancelForfeit(vi.fn().mockRejectedValue(new Error('provider down')));
  await expect(after.mock.calls[0][0]()).resolves.toBeUndefined();
});
