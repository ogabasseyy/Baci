import { expect, it, vi } from 'vitest';
import { readPiggyvestCustomerStatus } from './customer-status';
import { savingsViewFixture } from './savings-view.test-support';

vi.mock('server-only', () => ({}));

it('redacts authentication failures without executing ledger reads', async () => {
  const execute = vi.fn();
  const result = await readPiggyvestCustomerStatus({
    configuration: savingsViewFixture().configuration,
    resolveAuthenticatedGoal: async () => {
      throw new Error('Synthetic private authentication detail');
    },
    execute,
  });
  expect(result).toEqual({ status: 'unavailable' });
  expect(execute).not.toHaveBeenCalled();
});

it('returns no device or financial fields when a trusted ledger read fails', async () => {
  const fixture = savingsViewFixture();
  const execute = vi.fn(async () => {
    throw new Error('Synthetic private database detail');
  });
  const result = await readPiggyvestCustomerStatus({
    configuration: fixture.configuration,
    resolveAuthenticatedGoal: async () => ({
      goal: fixture.goal,
      device: {
        productName: 'Synthetic device',
        variant: '128GB / Black',
        condition: 'New',
      },
    }),
    execute,
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ status: 'unavailable' });
});
