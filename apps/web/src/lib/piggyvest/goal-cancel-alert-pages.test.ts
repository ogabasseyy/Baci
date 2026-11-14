import { expect, it, vi } from 'vitest';
import { pageGoalCancelAlerts } from './goal-cancel-alert-pages';

it('pages then acknowledges each alert, in that order', async () => {
  const order: string[] = [];
  const result = await pageGoalCancelAlerts({
    items: ['a', 'b'],
    emit: (item) => order.push(`page ${item}`),
    acknowledge: async (item) => order.push(`ack ${item}`),
    now: () => 0,
  });
  // Regression: every alert is paged before any acknowledgement is awaited.
  expect(order).toEqual(['page a', 'page b', 'ack a', 'ack b']);
  expect(result).toEqual({ paged: 2, failed: 0 });
});

it('bugfix: stops paging at the deadline, leaving the rest for the next run', async () => {
  let clock = 1000;
  const emit = vi.fn();
  const result = await pageGoalCancelAlerts({
    items: ['a', 'b', 'c'],
    emit,
    acknowledge: async () => true,
    deadlineAt: 1500,
    now: () => {
      const current = clock;
      clock += 1000;
      return current;
    },
  });
  expect(emit).toHaveBeenCalledOnce();
  expect(result).toEqual({ paged: 1, failed: 0 });
});

it('counts a failed acknowledgement and carries on', async () => {
  const result = await pageGoalCancelAlerts({
    items: ['a', 'b'],
    emit: vi.fn(),
    acknowledge: vi
      .fn()
      .mockRejectedValueOnce(new Error('db'))
      .mockResolvedValueOnce(true),
    now: () => 0,
  });
  expect(result).toEqual({ paged: 2, failed: 1 });
});
