import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Haptics from 'expo-haptics';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { notifySavings } from './savings/savings-notice';
import { buildSavingsSuccessMessage } from './savings-contribution-success';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.mock('./savings/savings-notice', () => {
  const notifySavings = jest.fn();
  return { notifySavings, savingsNotifier: () => notifySavings };
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

const baseParams = {
  clearSavingsContributionAmount: jest.fn(),
  createIdempotencyKey: () => 'op-1',
  goal,
  refetchWallet: async () => ({}),
  setIsAddingSavingsContribution: jest.fn(),
  walletBalance: 5000,
};

describe('buildSavingsSuccessMessage', () => {
  it('shows progress from the confirmed amount', () => {
    expect(
      buildSavingsSuccessMessage({
        amount: 1000,
        goal,
        goalCompleted: false,
        refreshFailed: false,
        savedAfter: 1500,
      })
    ).toEqual({
      message:
        "Nice! ₦1,000 added. You're 30% of the way to your iPhone 13. Keep it going!",
      title: 'Savings updated',
    });
  });

  it('celebrates a completed goal', () => {
    const result = buildSavingsSuccessMessage({
      amount: 4500,
      goal,
      goalCompleted: true,
      refreshFailed: false,
    });
    expect(result.title).toBe('Goal reached! 🎉');
    expect(result.message).toContain('reached your iPhone 13 goal');
  });

  it('never claims 100% before the goal is complete and never shows 0%', () => {
    const almost = buildSavingsSuccessMessage({
      amount: 4499,
      goal,
      goalCompleted: false,
      refreshFailed: false,
      savedAfter: 4999,
    });
    expect(almost.message).toContain("You're 99%");
    const tiny = buildSavingsSuccessMessage({
      amount: 1,
      goal: { ...goal, current_amount: 0, target_amount: 1_000_000 },
      goalCompleted: false,
      refreshFailed: false,
      savedAfter: 1,
    });
    expect(tiny.message).toContain("You're 1%");
  });

  it('skips the percentage when the target is missing', () => {
    const result = buildSavingsSuccessMessage({
      amount: 500,
      goal: { ...goal, target_amount: 0 },
      goalCompleted: false,
      refreshFailed: false,
    });
    expect(result.message).toBe(
      'Nice! ₦500 added. Every naira gets you closer to your iPhone 13. Keep it going!'
    );
  });

  it('shows no percentage without a server-confirmed balance', () => {
    const result = buildSavingsSuccessMessage({
      amount: 1000,
      goal,
      goalCompleted: false,
      refreshFailed: false,
    });
    expect(result.message).toBe(
      'Nice! ₦1,000 added. Every naira gets you closer to your iPhone 13. Keep it going!'
    );
  });

  it('prefers the server-confirmed balance over the client snapshot', () => {
    // Regression: a replayed contribution whose goal already refreshed would
    // double-count the amount (₦500 + ₦1,000 + ₦1,000 = 50%). The server's
    // goal balance after the contribution (₦1,500 of ₦5,000) is 30%.
    const result = buildSavingsSuccessMessage({
      amount: 1000,
      goal: { ...goal, current_amount: 1500 },
      goalCompleted: false,
      refreshFailed: false,
      savedAfter: 1500,
    });
    expect(result.message).toContain("You're 30%");
  });

  it('adds the refresh hint when the wallet refresh failed', () => {
    const result = buildSavingsSuccessMessage({
      amount: 500,
      goal,
      goalCompleted: false,
      refreshFailed: true,
    });
    expect(result.message).toMatch(/Pull to refresh your latest balance\.$/);
  });
});

describe('success feedback is bound to confirmed contributions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the legacy response balance for progress', async () => {
    await addSavingsContributionToGoal({
      ...baseParams,
      addSavingsContribution: async () => ({
        goalCurrentAmount: 1500,
        goalStatus: 'active',
      }),
      goal: { ...goal, current_amount: 1500 },
      rawAmount: '1000',
    });
    expect(notifySavings).toHaveBeenCalledWith(
      'Savings updated',
      "Nice! ₦1,000 added. You're 30% of the way to your iPhone 13. Keep it going!",
      'success'
    );
  });

  it('trusts the server verdict over the client guess on a replayed contribution', async () => {
    const cancelSavingsReminder = jest.fn(async () => true);
    // ₦1,000 already landed (goal refreshed to ₦1,500 of ₦2,500); the replay
    // says the goal is still active, so no "Goal reached!" at 60%.
    await addSavingsContributionToGoal({
      ...baseParams,
      addSavingsContribution: async () => ({
        goalCurrentAmount: 1500,
        goalStatus: 'active',
      }),
      cancelSavingsReminder,
      goal: { ...goal, current_amount: 1500, target_amount: 2500 },
      rawAmount: '1000',
    });
    expect(notifySavings).toHaveBeenCalledWith(
      'Savings updated',
      "Nice! ₦1,000 added. You're 60% of the way to your iPhone 13. Keep it going!",
      'success'
    );
    // The reminder stays: the server says the goal is still active.
    expect(cancelSavingsReminder).not.toHaveBeenCalled();
  });

  it('buzzes once after a confirmed contribution', async () => {
    await addSavingsContributionToGoal({
      ...baseParams,
      addSavingsContribution: async () => ({ goalStatus: 'active' }),
      rawAmount: '500',
    });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success
    );
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pending', { status: 'pending' }],
    ['cancelled', { status: 'cancelled' }],
  ])('stays quiet when the contribution is %s', async (_label, result) => {
    await addSavingsContributionToGoal({
      ...baseParams,
      addSavingsContribution: async () => result,
      rawAmount: '500',
    });
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(notifySavings).not.toHaveBeenCalledWith(
      'Savings updated',
      expect.any(String),
      expect.anything()
    );
  });

  it('stays quiet when the contribution fails', async () => {
    await addSavingsContributionToGoal({
      ...baseParams,
      addSavingsContribution: async () => {
        throw new Error('network');
      },
      rawAmount: '500',
    });
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});
