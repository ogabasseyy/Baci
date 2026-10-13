import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

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

describe('wallet-screen-savings.handlers', () => {
  it('preserves the amount and operation key without announcing success for pending PiggyVest settlement', async () => {
    const clearSavingsContributionAmount = jest.fn();
    const clearIdempotencyKey = jest.fn();
    const cancelSavingsReminder = jest.fn(async () => true);
    await addSavingsContributionToGoal({
      addSavingsContribution: async () => ({ status: 'pending' }),
      clearSavingsContributionAmount,
      clearIdempotencyKey,
      cancelSavingsReminder,
      createIdempotencyKey: () => 'pending-operation',
      goal,
      rawAmount: '4500',
      refetchWallet: async () => ({}),
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });
    expect(clearSavingsContributionAmount).not.toHaveBeenCalled();
    expect(clearIdempotencyKey).not.toHaveBeenCalled();
    expect(cancelSavingsReminder).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Contribution pending',
      expect.stringContaining('PiggyVest confirms')
    );
  });
  it('clears the operation without announcing success for a terminal cancellation', async () => {
    const clearSavingsContributionAmount = jest.fn();
    const clearIdempotencyKey = jest.fn();
    const cancelSavingsReminder = jest.fn(async () => true);
    const refetchWallet = jest.fn(async () => ({}));
    await addSavingsContributionToGoal({
      addSavingsContribution: async () => ({ status: 'cancelled' }),
      clearSavingsContributionAmount,
      clearIdempotencyKey,
      cancelSavingsReminder,
      createIdempotencyKey: () => 'cancelled-operation',
      goal,
      rawAmount: '4500',
      refetchWallet,
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });
    expect(clearIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(clearSavingsContributionAmount).not.toHaveBeenCalled();
    expect(cancelSavingsReminder).not.toHaveBeenCalled();
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Contribution cancelled',
      expect.stringContaining('funds were released')
    );
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Savings updated',
      expect.any(String)
    );
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds a valid savings contribution and refreshes the wallet', async () => {
    const addSavingsContribution = jest.fn(async () => ({}));
    const clearSavingsContributionAmount = jest.fn();
    const clearIdempotencyKey = jest.fn();
    const cancelSavingsReminder = jest.fn(async () => true);
    const refetchWallet = jest.fn(async () => ({}));
    const setIsAddingSavingsContribution = jest.fn();

    await addSavingsContributionToGoal({
      activeMerchantId: 'merchant-1',
      activeMerchantSlug: 'ogabassey',
      addSavingsContribution,
      clearSavingsContributionAmount,
      clearIdempotencyKey,
      cancelSavingsReminder,
      createIdempotencyKey: () => 'savings-key-1',
      goal,
      rawAmount: '500',
      refetchWallet,
      setIsAddingSavingsContribution,
      walletBalance: 5000,
    });

    expect(setIsAddingSavingsContribution).toHaveBeenNthCalledWith(1, true);
    expect(addSavingsContribution).toHaveBeenCalledWith({
      amount: 500,
      goalId: 'goal-1',
      idempotencyKey: 'savings-key-1',
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
    expect(clearSavingsContributionAmount).toHaveBeenCalledTimes(1);
    expect(clearIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(cancelSavingsReminder).not.toHaveBeenCalled();
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Savings updated',
      'Added ₦500 to your savings goal.'
    );
    expect(setIsAddingSavingsContribution).toHaveBeenLastCalledWith(false);
  });

  it('clears the idempotency key when wallet refresh fails after a contribution', async () => {
    const addSavingsContribution = jest.fn(async () => ({}));
    const clearSavingsContributionAmount = jest.fn();
    const clearIdempotencyKey = jest.fn();
    const refetchWallet = jest.fn(() =>
      Promise.reject(new Error('Refresh failed'))
    );

    await addSavingsContributionToGoal({
      addSavingsContribution,
      clearSavingsContributionAmount,
      clearIdempotencyKey,
      createIdempotencyKey: () => 'savings-key-1',
      goal,
      rawAmount: '500',
      refetchWallet,
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });

    expect(addSavingsContribution).toHaveBeenCalledTimes(1);
    expect(clearSavingsContributionAmount).toHaveBeenCalledTimes(1);
    expect(clearIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Savings updated',
      'Added ₦500 to your savings goal, but wallet refresh failed. Pull to refresh your latest balance.'
    );
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Unable to add savings',
      expect.any(String)
    );
  });

  it('cancels the stored reminder when a contribution completes the goal', async () => {
    const addSavingsContribution = jest.fn(async () => ({
      goalStatus: 'completed',
    }));
    const cancelSavingsReminder = jest.fn(async () => true);

    await addSavingsContributionToGoal({
      addSavingsContribution,
      cancelSavingsReminder,
      clearSavingsContributionAmount: jest.fn(),
      createIdempotencyKey: () => 'savings-key-1',
      goal,
      rawAmount: '500',
      refetchWallet: jest.fn(async () => undefined),
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });

    expect(cancelSavingsReminder).toHaveBeenCalledWith('goal-1');
  });

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
    expect(Alert.alert).toHaveBeenCalledWith(
      'Amount too high',
      'You only have ₦500 left on this goal.'
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
    expect(Alert.alert).toHaveBeenCalledWith(
      'Invalid amount',
      'Enter the amount you want to save.'
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
    expect(Alert.alert).toHaveBeenCalledWith(
      'No active savings goal',
      'Start a savings goal first.'
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
    expect(Alert.alert).toHaveBeenCalledWith(
      'Unable to add savings',
      'Contribution failed'
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
    expect(Alert.alert).toHaveBeenCalledWith(
      'Fund wallet first',
      'Your wallet has ₦100 available. Fund it before adding ₦500 to savings.'
    );
  });
});
