import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { notifySavings } from './savings/savings-notice';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.mock('./savings/savings-notice', () => {
  const notifySavings = jest.fn();
  return {
    clearSavingsNotice: jest.fn(),
    notifySavings,
    savingsNotifier: () => notifySavings,
  };
});

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
    expect(notifySavings).toHaveBeenCalledWith(
      'Contribution pending',
      expect.stringContaining('PiggyVest confirms'),
      'info'
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
    expect(notifySavings).toHaveBeenCalledWith(
      'Contribution cancelled',
      expect.stringContaining('funds were released'),
      'info'
    );
    expect(notifySavings).not.toHaveBeenCalledWith(
      'Savings updated',
      expect.any(String),
      expect.anything()
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
    expect(notifySavings).toHaveBeenCalledWith(
      'Savings updated',
      'Nice! ₦500 added. Every naira gets you closer to your iPhone 13. Keep it going!',
      'success'
    );
    expect(setIsAddingSavingsContribution).toHaveBeenLastCalledWith(false);
  });

  it('treats a refetch that resolves with isError as a failed refresh', async () => {
    await addSavingsContributionToGoal({
      addSavingsContribution: jest.fn(async () => ({})),
      clearSavingsContributionAmount: jest.fn(),
      clearIdempotencyKey: jest.fn(),
      createIdempotencyKey: () => 'savings-key-2',
      goal,
      rawAmount: '500',
      refetchWallet: jest.fn(async () => ({ isError: true })),
      setIsAddingSavingsContribution: jest.fn(),
      walletBalance: 5000,
    });
    expect(notifySavings).toHaveBeenCalledWith(
      'Savings updated',
      expect.stringMatching(/Pull to refresh your latest balance\.$/),
      'success'
    );
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
    expect(notifySavings).toHaveBeenCalledWith(
      'Savings updated',
      'Nice! ₦500 added. Every naira gets you closer to your iPhone 13. Keep it going! Pull to refresh your latest balance.',
      'success'
    );
    expect(notifySavings).not.toHaveBeenCalledWith(
      'Unable to add savings',
      expect.any(String),
      expect.anything()
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
});
