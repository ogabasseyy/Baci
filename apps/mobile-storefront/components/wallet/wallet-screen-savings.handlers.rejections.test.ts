import { describe, expect, it, jest } from '@jest/globals';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { notifySavings } from './savings/savings-notice';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.mock('./savings/savings-notice', () => ({
  clearSavingsNotice: jest.fn(),
  notifySavings: jest.fn(),
}));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 1000,
  contribution_frequency: 'weekly',
  current_amount: 500,
  id: 'goal-1',
  maturity_date: '2026-09-30',
  product_condition: 'Used',
  product_variant_label: 'Storage: 128GB',
  source_mode: 'manual',
  status: 'active',
  target_amount: 5000,
  title: 'iPhone 13',
};

describe('wallet-screen-savings.handlers: refused contributions', () => {
  it('rejects savings contributions above the remaining goal amount', async () => {
    const addSavingsContribution = jest.fn(async () => ({}));

    await addSavingsContributionToGoal({
      addSavingsContribution,
      clearSavingsContributionAmount: jest.fn(),
      createIdempotencyKey: () => 'savings-key-1',
      goal: { ...goal, current_amount: 4500 },
      rawAmount: '1000',
      refetchWallet: jest.fn(async () => undefined),
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });

    expect(addSavingsContribution).not.toHaveBeenCalled();
    expect(notifySavings).toHaveBeenCalledWith(
      'Amount too high',
      'You only have ₦500 left on this goal.',
      'warning'
    );
  });

  it.each([
    '',
    'not-a-number',
    '0',
    '-100',
    String(Number.NaN),
  ])('rejects invalid savings contribution amount %p', async (rawAmount) => {
    const addSavingsContribution = jest.fn(async () => ({}));

    await addSavingsContributionToGoal({
      addSavingsContribution,
      clearSavingsContributionAmount: jest.fn(),
      createIdempotencyKey: () => 'savings-key-1',
      goal,
      rawAmount,
      refetchWallet: jest.fn(async () => undefined),
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });

    expect(addSavingsContribution).not.toHaveBeenCalled();
    expect(notifySavings).toHaveBeenCalledWith(
      'Invalid amount',
      'Enter the amount you want to save.',
      'warning'
    );
  });

  it('rejects savings contributions when no active goal is available', async () => {
    const addSavingsContribution = jest.fn(async () => ({}));

    await addSavingsContributionToGoal({
      addSavingsContribution,
      clearSavingsContributionAmount: jest.fn(),
      createIdempotencyKey: () => 'savings-key-1',
      goal: null,
      rawAmount: '500',
      refetchWallet: jest.fn(async () => undefined),
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });

    expect(addSavingsContribution).not.toHaveBeenCalled();
    expect(notifySavings).toHaveBeenCalledWith(
      'No active savings goal',
      'Start a savings goal first.',
      'warning'
    );
  });

  it('shows API errors and clears pending state', async () => {
    const addSavingsContribution = jest.fn(() =>
      Promise.reject(new Error('Contribution failed'))
    );
    const clearSavingsContributionAmount = jest.fn();
    const clearIdempotencyKey = jest.fn();
    const refetchWallet = jest.fn(async () => undefined);
    const setIsAddingSavingsContribution = jest.fn();

    await addSavingsContributionToGoal({
      addSavingsContribution,
      clearSavingsContributionAmount,
      clearIdempotencyKey,
      createIdempotencyKey: () => 'savings-key-1',
      goal,
      rawAmount: '500',
      refetchWallet,
      setIsAddingSavingsContribution,
      walletBalance: 5000,
    });

    expect(setIsAddingSavingsContribution).toHaveBeenNthCalledWith(1, true);
    expect(clearSavingsContributionAmount).not.toHaveBeenCalled();
    expect(clearIdempotencyKey).not.toHaveBeenCalled();
    expect(refetchWallet).not.toHaveBeenCalled();
    expect(notifySavings).toHaveBeenCalledWith(
      'Unable to add savings',
      'Contribution failed',
      'warning'
    );
    expect(setIsAddingSavingsContribution).toHaveBeenLastCalledWith(false);
  });

  it('does not submit a contribution when the spendable wallet balance is too low', async () => {
    const addSavingsContribution = jest.fn(async () => ({}));
    const setIsAddingSavingsContribution = jest.fn();

    await addSavingsContributionToGoal({
      addSavingsContribution,
      clearSavingsContributionAmount: jest.fn(),
      createIdempotencyKey: () => 'savings-key-1',
      goal,
      rawAmount: '500',
      refetchWallet: jest.fn(async () => undefined),
      setIsAddingSavingsContribution,
      walletBalance: 100,
    });

    expect(addSavingsContribution).not.toHaveBeenCalled();
    expect(setIsAddingSavingsContribution).not.toHaveBeenCalled();
    expect(notifySavings).toHaveBeenCalledWith(
      'Add money first',
      'Your wallet has ₦100 available. Fund it before adding ₦500 to savings.',
      'warning'
    );
  });
});
