import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CustomerSavingsStatus } from '@/components/storefront/piggyvest-savings/customer-savings-status';
import { readPiggyvestCustomerStatus } from './customer-status';
import { savingsViewFixture } from './savings-view.test-support';

vi.mock('server-only', () => ({}));

it('renders server ledger purchasing power without converting pending interest into cash', async () => {
  const fixture = savingsViewFixture();
  const resolveAuthenticatedGoal = vi.fn(async () => ({
    goal: fixture.goal,
    device: {
      productName: 'Synthetic device',
      variant: '128GB / Black',
      condition: 'New',
    },
  }));
  const result = await readPiggyvestCustomerStatus({
    configuration: fixture.configuration,
    resolveAuthenticatedGoal,
    execute: async () => ({ rows: [{ result: fixture.stored }] }),
    now: () => new Date('2026-09-12T12:00:00.000Z'),
  });
  expect(resolveAuthenticatedGoal).toHaveBeenCalledTimes(1);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready')
    throw new Error('Expected ready synthetic state');
  expect(result.decision.purchasingPowerKobo).toBe(9500);
  expect(result.pendingInterestKobo).toBe(500);
  expect(result).not.toHaveProperty('identity');
  render(
    <CustomerSavingsStatus
      {...result}
      actionPending={false}
      onReviewPurchase={vi.fn()}
    />
  );
  expect(screen.getByText('128GB / Black')).toBeVisible();
  expect(screen.getByText('Pending interest — not spendable')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Review purchase' })
  ).not.toBeInTheDocument();
});

it('returns no device or balances for another customer or failed authentication', async () => {
  const fixture = savingsViewFixture();
  const execute = vi.fn();
  for (const resolved of [
    null,
    {
      goal: {
        ...fixture.goal,
        identity: {
          ...fixture.goal.identity,
          customerId: '99999999-9999-4999-8999-999999999999',
        },
      },
      device: {
        productName: 'Private device',
        variant: 'Private variant',
        condition: 'New',
      },
    },
  ]) {
    expect(
      await readPiggyvestCustomerStatus({
        configuration: fixture.configuration,
        resolveAuthenticatedGoal: async () => resolved,
        execute,
      })
    ).toEqual({ status: 'unavailable' });
  }
  expect(execute).not.toHaveBeenCalled();
});
