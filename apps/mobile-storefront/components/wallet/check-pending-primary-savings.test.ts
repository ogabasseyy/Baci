import { beforeEach, expect, it, jest } from '@jest/globals';
import { checkPendingPrimarySavings } from './check-pending-primary-savings';
import { notifySavings } from './savings/savings-notice';

const mockCheck = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/piggyvest-primary-savings-status', () => ({
  checkPiggyvestPrimarySavingsStatus: (...args: unknown[]) =>
    mockCheck(...args),
}));
jest.mock('./savings/savings-notice', () => {
  const notifySavings = jest.fn();
  return { notifySavings, savingsNotifier: () => notifySavings };
});
function input() {
  return {
    merchantId: 'merchant',
    operationId: 'operation',
    clearOperation: jest.fn(),
    clearAmount: jest.fn(),
    refetchWallet: jest.fn(async () => undefined),
    setPending: jest.fn<(value: boolean) => void>(),
  };
}
beforeEach(() => {
  jest.clearAllMocks();
});
it('keeps the operation and amount on pending status even when spendable funds are zero', async () => {
  const props = input();
  mockCheck.mockResolvedValue({ status: 'pending', operationId: 'operation' });
  await checkPendingPrimarySavings(props);
  expect(props.clearOperation).not.toHaveBeenCalled();
  expect(props.clearAmount).not.toHaveBeenCalled();
  expect(notifySavings).toHaveBeenCalledWith(
    'Contribution pending',
    expect.any(String),
    'info'
  );
});
it('clears the retained operation only after confirmed settlement', async () => {
  const props = input();
  mockCheck.mockResolvedValue({
    status: 'confirmed',
    operationId: 'operation',
  });
  await checkPendingPrimarySavings(props);
  expect(props.clearOperation).toHaveBeenCalledTimes(1);
  expect(props.clearAmount).toHaveBeenCalledTimes(1);
  expect(props.refetchWallet).toHaveBeenCalledTimes(1);
});
it('preserves retry identity when status is unavailable', async () => {
  const props = input();
  mockCheck.mockRejectedValue(new Error('unavailable'));
  await checkPendingPrimarySavings(props);
  expect(props.clearOperation).not.toHaveBeenCalled();
  expect(props.clearAmount).not.toHaveBeenCalled();
  expect(props.setPending).toHaveBeenLastCalledWith(false);
});
it('releases the operation on authoritative not-found so the next tap re-submits', async () => {
  const props = input();
  mockCheck.mockRejectedValue(
    Object.assign(new Error('not found'), { code: 'CONTRIBUTION_NOT_FOUND' })
  );
  await checkPendingPrimarySavings(props);
  expect(props.clearOperation).toHaveBeenCalledTimes(1);
  expect(props.clearAmount).not.toHaveBeenCalled();
  expect(props.setPending).toHaveBeenLastCalledWith(false);
  expect(notifySavings).toHaveBeenCalledWith(
    'Contribution not received',
    expect.stringContaining('try again'),
    'info'
  );
});
it('keeps a primary operation when the merchant is reported not primary', async () => {
  // The answer comes from runtime config, not the provider record, so a
  // stale binding must never release an id the primary rail may hold.
  const props = input();
  mockCheck.mockRejectedValue(
    Object.assign(new Error('np'), { code: 'SAVINGS_MERCHANT_NOT_PRIMARY' })
  );
  await checkPendingPrimarySavings(props);
  expect(props.clearOperation).not.toHaveBeenCalled();
  expect(notifySavings).toHaveBeenCalledWith(
    'Status unavailable',
    expect.any(String),
    'warning'
  );
});
const pendingGoal = {
  contribution_amount: 1000,
  contribution_frequency: 'weekly',
  current_amount: 0,
  id: 'goal-1',
  maturity_date: '2026-09-30',
  product_condition: 'Used',
  product_variant_label: 'Storage: 128GB',
  source_mode: 'manual',
  status: 'active',
  target_amount: 5000,
  title: 'iPhone 13',
} as const;
// Regression: in practice PiggyVest settles minutes later, so confirmation
// arrives through "Check contribution status". That path must cheer the
// customer, but the status endpoint returns no amount or goal balance and the
// amount field may have been edited, so it names the goal without either.
it('cheers a confirmation found by the status check without guessing amounts', async () => {
  mockCheck.mockResolvedValue({
    status: 'confirmed',
    operationId: 'operation',
  });
  await checkPendingPrimarySavings({ ...input(), goal: pendingGoal });
  expect(notifySavings).toHaveBeenCalledWith(
    'Savings updated',
    'Nice! PiggyVest confirmed your savings. Every naira gets you closer to your iPhone 13. Keep it going!',
    'success'
  );
  expect(notifySavings).not.toHaveBeenCalledWith(
    expect.any(String),
    expect.stringMatching(/₦|%/),
    expect.anything()
  );
});
it('keeps the plain confirmation when the goal is unknown', async () => {
  mockCheck.mockResolvedValue({
    status: 'confirmed',
    operationId: 'operation',
  });
  await checkPendingPrimarySavings(input());
  expect(notifySavings).toHaveBeenCalledWith(
    'Savings updated',
    'PiggyVest has confirmed your contribution. Your savings balance has been updated.',
    'success'
  );
});
it('does not cheer while the contribution is still pending', async () => {
  mockCheck.mockResolvedValue({ status: 'pending', operationId: 'operation' });
  await checkPendingPrimarySavings({ ...input(), goal: pendingGoal });
  expect(notifySavings).not.toHaveBeenCalledWith(
    'Savings updated',
    expect.any(String),
    expect.anything()
  );
});
it('never claims the goal is reached on a late confirmation', async () => {
  mockCheck.mockResolvedValue({
    status: 'confirmed',
    operationId: 'operation',
  });
  await checkPendingPrimarySavings({
    ...input(),
    goal: { ...pendingGoal, current_amount: 5000 },
  });
  expect(notifySavings).not.toHaveBeenCalledWith(
    'Goal reached! 🎉',
    expect.any(String),
    expect.anything()
  );
});
it('adds the refresh hint to the status-check cheer when the wallet refresh fails', async () => {
  mockCheck.mockResolvedValue({
    status: 'confirmed',
    operationId: 'operation',
  });
  await checkPendingPrimarySavings({
    ...input(),
    goal: pendingGoal,
    refetchWallet: jest.fn(() => Promise.reject(new Error('offline'))),
  });
  expect(notifySavings).toHaveBeenCalledWith(
    'Savings updated',
    expect.stringMatching(/Pull to refresh your latest balance\.$/),
    'success'
  );
});
